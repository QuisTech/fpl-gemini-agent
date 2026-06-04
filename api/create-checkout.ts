import DodoPayments from 'dodopayments';

const dodo = new DodoPayments({
  secretKey: process.env.DODO_SECRET_KEY,
  mode: process.env.NODE_ENV === 'production' ? 'live' : 'test'
});

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { userId, tier, successUrl, cancelUrl } = req.body;
  
  if (!userId || !tier) {
    return res.status(400).json({ error: 'Missing userId or tier' });
  }
  
  // Price IDs from Dodo Payments dashboard
  const prices = {
    strategist: process.env.DODO_PRICE_STRATEGIST,
    grandCru: process.env.DODO_PRICE_GRAND_CRU,
    aiAgent: process.env.DODO_PRICE_AI_AGENT
  };
  
  const priceId = prices[tier];
  if (!priceId) {
    return res.status(400).json({ error: 'Invalid tier selected' });
  }
  
  try {
    // Create checkout session with Dodo Payments
    const session = await dodo.checkout.sessions.create({
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: successUrl || `${process.env.APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.APP_URL}/pricing`,
      client_reference_id: userId,
      metadata: {
        tier,
        userId
      }
    });
    
    // Return the checkout URL
    res.json({
      success: true,
      url: session.url,
      sessionId: session.id
    });
    
  } catch (error) {
    console.error('Dodo Payments error:', error);
    res.status(500).json({
      error: 'Failed to create checkout session',
      message: error.message
    });
  }
}
