import { getFirestore } from '../lib/firestore.js';

const db = getFirestore();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, limit = '50' } = req.query;
  
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    // Get AI decisions
    const decisionsSnapshot = await db.collection('ai_decisions')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit))
      .get();
    
    const decisions = decisionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp
    }));

    // Get revenue from Dodo Payments
    const revenueSnapshot = await db.collection('revenue')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    
    const revenue = revenueSnapshot.docs.map(doc => ({
      amount: doc.data().amount,
      tier: doc.data().tier,
      currency: doc.data().currency,
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
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}
