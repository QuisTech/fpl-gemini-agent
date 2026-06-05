import 'dotenv/config';
import DodoPayments from 'dodopayments';

async function test(env) {
  try {
    const dodo = new DodoPayments({
      bearerToken: process.env.DODO_SECRET_KEY,
      environment: env
    });
    
    console.log(`Testing ${env}...`);
    const session = await dodo.checkoutSessions.create({
      product_cart: [{ product_id: process.env.DODO_PRICE_STRATEGIST, quantity: 1 }],
      return_url: 'http://localhost:3000/dashboard',
      customer: { email: 'test@example.com', name: 'Test' }
    });
    console.log(`Success in ${env}! URL:`, session.checkout_url);
    return true;
  } catch (e) {
    console.log(`Failed in ${env}:`, e.message);
    return false;
  }
}

async function run() {
  const t = await test('test_mode');
  if (!t) await test('live_mode');
}

run();
