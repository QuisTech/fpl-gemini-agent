import DodoPayments from 'dodopayments';
import { Firestore } from '@google-cloud/firestore';

const dodo = new DodoPayments({
  bearerToken: process.env.DODO_SECRET_KEY?.trim(),
  environment: process.env.DODO_SECRET_KEY?.includes('test') ? 'test_mode' : 'live_mode'
});

const db = new Firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['dodo-signature'];
  
  if (!signature) {
    return res.status(400).json({ error: 'Missing signature' });
  }

  try {
    // Verify webhook signature
    const event = dodo.webhooks.unwrap(
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
      {
        headers: req.headers as Record<string, string>,
        key: process.env.DODO_WEBHOOK_SECRET?.trim()
      }
    );

    switch (event.type) {
      case 'payment.succeeded':
      case 'subscription.active': {
        const session = event.data as any;
        await db.collection('users').doc(session.client_reference_id || session.customer_id || session.metadata?.userId || 'unknown').set({
          dodoCustomerId: session.customer_id || session.customer?.customer_id || '',
          tier: session.metadata?.tier || 'free',
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
