import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { userId, tier } = req.body;
  
  const prices = {
    strategist: process.env.STRIPE_PRICE_STRATEGIST,
    grandCru: process.env.STRIPE_PRICE_GRAND_CRU,
    aiAgent: process.env.STRIPE_PRICE_AI_AGENT
  };
  
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: prices[tier], quantity: 1 }],
    mode: 'subscription',
    success_url: `${process.env.APP_URL}/dashboard`,
    cancel_url: `${process.env.APP_URL}/pricing`,
    client_reference_id: userId,
    metadata: { tier }
  });
  
  res.json({ url: session.url });
}
