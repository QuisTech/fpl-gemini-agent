import DodoPayments from 'dodopayments';
import { getFirestore } from '../lib/firestore.js';

const dodo = new DodoPayments({
  bearerToken: process.env.DODO_SECRET_KEY?.trim(),
  environment: process.env.DODO_SECRET_KEY?.includes('test') ? 'test_mode' : 'live_mode'
});

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: any) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }



  try {
    const rawBody = await getRawBody(req);
    
    // Verify webhook signature
    const event = dodo.webhooks.unwrap(
      rawBody,
      {
        headers: req.headers as Record<string, string>,
        key: process.env.DODO_WEBHOOK_SECRET?.trim()
      }
    );

    switch (event.type) {
      case 'payment.succeeded':
      case 'subscription.active': {
        const session = event.data as any;
        const db = getFirestore();
        const userId = session.metadata?.userId || session.client_reference_id || session.customer_id || 'unknown';
        const tier = session.metadata?.tier || 'free';
        
        console.log(`Webhook triggered for user: ${userId}, upgrading to tier: ${tier}`);
        
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        const currentTier = userDoc.exists ? (userDoc.data()?.tier || 'free') : 'free';
        
        const tierHierarchy: Record<string, number> = { free: 0, strategist: 1, grandCru: 2, aiAgent: 3 };
        
        let finalTier = tier;
        // Prevent downgrading from older delayed webhook retries
        if ((tierHierarchy[currentTier] || 0) > (tierHierarchy[tier] || 0)) {
           finalTier = currentTier;
           console.log(`[Safety] Prevented downgrade: User is already ${currentTier}, ignoring ${tier} webhook`);
        }

        await userRef.set({
          dodoCustomerId: session.customer_id || session.customer?.customer_id || '',
          tier: finalTier,
          status: 'active',
          subscriptionId: session.subscription_id || session.subscription || '',
          updatedAt: new Date()
        }, { merge: true });
        
        // Log revenue for XPRIZE
        await db.collection('revenue').add({
          userId: session.client_reference_id || session.customer_id || session.metadata?.userId || 'unknown',
          amount: (session.total_amount || session.amount_total || 0) / 100,
          currency: session.currency || 'USD',
          tier: session.metadata?.tier || 'free',
          timestamp: new Date(),
          transactionId: session.payment_id || session.id
        });
        break;
      }

      case 'subscription.cancelled': {
        const subscription = event.data as any;
        const db = getFirestore();
        const userQuery = await db.collection('users')
          .where('subscriptionId', '==', subscription.subscription_id || subscription.id)
          .limit(1)
          .get();
        
        userQuery.forEach(doc => {
          doc.ref.update({ 
            status: 'canceled', 
            tier: 'free',
            updatedAt: new Date()
          });
        });
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: error.message });
  }
}
