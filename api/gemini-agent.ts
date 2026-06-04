import { GoogleGenAI } from "@google/genai";
import { Firestore } from '@google-cloud/firestore';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const db = new Firestore();

export async function getGeminiTransferDecision(squad, gameweek, fixtures, bank) {
  const prompt = `You are an FPL expert. Current squad has ${squad.length} players. GW${gameweek} fixtures...`;
  
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { temperature: 0.3, responseMimeType: "application/json" }
  });
  
  const decision = JSON.parse(response.text);
  
  await db.collection('ai_decisions').add({
    gameweek, decision, timestamp: new Date()
  });
  
  return decision;
}

export async function getGeminiChipAdvice(squad, chips, gameweek) {
  const prompt = `Chips available: ${Object.keys(chips).filter(c=>chips[c]).join(', ')}. Should I play one?`;
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  return JSON.parse(response.text);
}
