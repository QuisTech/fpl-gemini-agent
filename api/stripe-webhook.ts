import Stripe from 'stripe';
import { Firestore } from '@google-cloud/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const db = new Firestore();

export default async function handler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      await db.collection('users').doc(session.client_reference_id).set({
        stripeCustomerId: session.customer,
        tier: session.metadata.tier,
        status: 'active',
        updatedAt: new Date()
      }, { merge: true });
      
      await db.collection('revenue').add({
        userId: session.client_reference_id,
        amount: session.amount_total / 100,
        tier: session.metadata.tier,
        timestamp: new Date()
      });
      break;
      
    case 'customer.subscription.deleted':
      const subscription = event.data.object;
      const userQuery = await db.collection('users').where('stripeCustomerId', '==', subscription.customer).get();
      userQuery.forEach(doc => {
        doc.ref.update({ status: 'canceled', tier: 'free' });
      });
      break;
  }

  res.json({ received: true });
}
