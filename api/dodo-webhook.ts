import DodoPayments from 'dodopayments';
import { Firestore } from '@google-cloud/firestore';

const dodo = new DodoPayments({
  secretKey: process.env.DODO_SECRET_KEY,
  mode: process.env.NODE_ENV === 'production' ? 'live' : 'test'
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
    const event = dodo.webhooks.constructEvent(
      req.body,
      signature,
      process.env.DODO_WEBHOOK_SECRET
    );

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data;
        await db.collection('users').doc(session.client_reference_id).set({
          dodoCustomerId: session.customer,
          tier: session.metadata.tier,
          status: 'active',
          subscriptionId: session.subscription,
          updatedAt: new Date()
        }, { merge: true });
        
        // Log revenue for XPRIZE
        await db.collection('revenue').add({
          userId: session.client_reference_id,
          amount: session.amount_total / 100,
          currency: session.currency,
          tier: session.metadata.tier,
          timestamp: new Date(),
          transactionId: session.id
        });
        break;

      case 'subscription.canceled':
        const subscription = event.data;
        const userQuery = await db.collection('users')
          .where('subscriptionId', '==', subscription.id)
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

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: error.message });
  }
}
