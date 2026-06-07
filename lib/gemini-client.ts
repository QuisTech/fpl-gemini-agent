import { GoogleGenAI } from "@google/genai";

// ─── Model Tiers (priority order: best → most available) ───────────────
const MODEL_TIERS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
] as const;

type ModelTier = (typeof MODEL_TIERS)[number];

// ─── Key Management ────────────────────────────────────────────────────
function getApiKeys(): string[] {
  const keys: string[] = [];
  const envKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
  ];
  for (const k of envKeys) {
    if (k && k.trim() && !k.startsWith("AIza...")) {
      keys.push(k.trim());
    }
  }
  if (keys.length === 0) {
    throw new Error(
      "[GeminiClient] FATAL: No valid GEMINI_API_KEY environment variables found."
    );
  }
  return keys;
}

// ─── Retry Config ──────────────────────────────────────────────────────
const MAX_RETRIES_PER_KEY = 3;
const BASE_DELAY_MS = 500;

function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.httpStatusCode ?? err?.code;
  // 429 = rate limit, 500/502/503 = server errors, ECONNRESET etc.
  if ([429, 500, 502, 503].includes(status)) return true;
  const msg = String(err?.message || "").toLowerCase();
  if (
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("resource exhausted") ||
    msg.includes("overloaded") ||
    msg.includes("unavailable") ||
    msg.includes("internal") ||
    msg.includes("econnreset") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed")
  )
    return true;
  return false;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Types ─────────────────────────────────────────────────────────────
export interface GeminiCallOptions {
  prompt: string;
  temperature?: number;
  jsonMode?: boolean;
}

export interface GeminiCallResult {
  text: string;
  modelUsed: ModelTier;
  keyIndex: number;
  attempts: number;
}

// ─── Main Resilient Caller ─────────────────────────────────────────────
/**
 * Calls Gemini with full fallback chain:
 *   For each MODEL (best → fallback):
 *     For each API KEY (primary → backup):
 *       Retry up to 3x with exponential backoff
 *
 * Total worst-case attempts: 4 models × 3 keys × 3 retries = 36
 * But we bail early on non-retryable errors (auth, bad request, etc.)
 * Practical worst-case time: ~18s (safe under Vercel 30s limit)
 */
export async function callGeminiWithFallback(
  options: GeminiCallOptions
): Promise<GeminiCallResult> {
  const keys = getApiKeys();
  const errors: Array<{
    model: string;
    keyIndex: number;
    attempt: number;
    error: string;
  }> = [];
  let totalAttempts = 0;

  for (const model of MODEL_TIERS) {
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      const ai = new GoogleGenAI({ apiKey: keys[keyIndex] });

      for (let attempt = 1; attempt <= MAX_RETRIES_PER_KEY; attempt++) {
        totalAttempts++;
        try {
          console.log(
            `[GeminiClient] Trying model=${model} key=${keyIndex + 1}/${keys.length} attempt=${attempt}/${MAX_RETRIES_PER_KEY}`
          );

          const response = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: options.prompt }] }],
            config: {
              temperature: options.temperature ?? 0.3,
              ...(options.jsonMode
                ? { responseMimeType: "application/json" }
                : {}),
            },
          });

          const text = response.text;
          if (!text || text.trim().length === 0) {
            throw new Error("Empty response from Gemini");
          }

          console.log(
            `[GeminiClient] ✓ Success on model=${model} key=${keyIndex + 1} after ${totalAttempts} total attempt(s)`
          );

          return {
            text,
            modelUsed: model,
            keyIndex: keyIndex + 1,
            attempts: totalAttempts,
          };
        } catch (err: any) {
          const errorMsg = err?.message || String(err);
          errors.push({
            model,
            keyIndex: keyIndex + 1,
            attempt,
            error: errorMsg,
          });
          console.warn(
            `[GeminiClient] ✗ Failed model=${model} key=${keyIndex + 1} attempt=${attempt}: ${errorMsg}`
          );

          // Non-retryable errors: skip retries, move to next key
          if (!isRetryableError(err)) {
            console.warn(
              `[GeminiClient] Non-retryable error, skipping remaining retries for this key`
            );
            break;
          }

          // Exponential backoff before retry (but not after last attempt)
          if (attempt < MAX_RETRIES_PER_KEY) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            console.log(`[GeminiClient] Backing off ${delay}ms...`);
            await sleep(delay);
          }
        }
      }
    }
  }

  // All keys × all models × all retries exhausted
  console.error(
    `[GeminiClient] EXHAUSTED all ${totalAttempts} attempts across ${MODEL_TIERS.length} models and ${keys.length} keys`
  );
  console.error(`[GeminiClient] Error log:`, JSON.stringify(errors, null, 2));

  throw new GeminiExhaustedError(
    `All Gemini API keys and models exhausted after ${totalAttempts} attempts. Last error: ${errors[errors.length - 1]?.error}`,
    errors
  );
}

// ─── Custom Error ──────────────────────────────────────────────────────
export class GeminiExhaustedError extends Error {
  public readonly errors: Array<{
    model: string;
    keyIndex: number;
    attempt: number;
    error: string;
  }>;

  constructor(
    message: string,
    errors: Array<{
      model: string;
      keyIndex: number;
      attempt: number;
      error: string;
    }>
  ) {
    super(message);
    this.name = "GeminiExhaustedError";
    this.errors = errors;
  }
}
