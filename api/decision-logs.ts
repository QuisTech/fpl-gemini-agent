import { Firestore } from '@google-cloud/firestore';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const db = new Firestore();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { userId, limit = '50' } = req.query;
  
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }
  
  try {
    // Query Firestore for AI decisions
    const snapshot = await db.collection('ai_decisions')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit as string))
      .get();
    
    const decisions = snapshot.docs.map(doc => ({
      id: doc.id,
      gameweek: doc.data().gameweek,
      decision: doc.data().decision,
      reasoning: doc.data().reasoning,
      confidence: doc.data().confidence,
      details: doc.data().details || {},
      timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp,
      modelUsed: doc.data().modelUsed || 'gemini-2.0-flash'
    }));
    
    // Also return revenue data for XPRIZE submission
    const revenueSnapshot = await db.collection('revenue')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    
    const revenue = revenueSnapshot.docs.map(doc => ({
      amount: doc.data().amount,
      tier: doc.data().tier,
      timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp
    }));
    
    const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
    
    res.json({
      success: true,
      decisions,
      revenue: {
        transactions: revenue,
        total: totalRevenue,
        currency: 'USD'
      },
      metadata: {
        lastUpdated: new Date().toISOString(),
        sampleSize: decisions.length
      }
    });
    
  } catch (error: any) {
    console.error('Error fetching decision logs:', error);
    res.status(500).json({ 
      error: 'Failed to fetch decision logs',
      message: error.message 
    });
  }
}
