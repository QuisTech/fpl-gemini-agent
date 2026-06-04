import { Firestore } from '@google-cloud/firestore';

let db: Firestore | null = null;

export function getFirestore(): Firestore {
  if (!db) {
    db = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      // In development, use emulator if available
      ...(process.env.NODE_ENV === 'development' && process.env.FIRESTORE_EMULATOR_HOST ? {
        host: process.env.FIRESTORE_EMULATOR_HOST,
        ssl: false
      } : {})
    });
  }
  return db;
}

export interface AIDecision {
  userId: string;
  gameweek: number;
  decision: string;
  reasoning: string;
  confidence: number;
  details: {
    transfersIn?: number[];
    transfersOut?: number[];
    chipName?: string;
  };
  timestamp: Date;
  modelUsed: string;
  riskMode?: string;
}

export async function logAIDecision(decision: AIDecision): Promise<string> {
  const db = getFirestore();
  const docRef = await db.collection('ai_decisions').add({
    ...decision,
    timestamp: new Date()
  });
  return docRef.id;
}

export async function getAIDecisions(userId: string, limit = 50): Promise<AIDecision[]> {
  const db = getFirestore();
  const snapshot = await db.collection('ai_decisions')
    .where('userId', '==', userId)
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get();
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as any));
}
