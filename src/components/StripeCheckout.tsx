import { useState } from 'react';

interface Props {
  userId: string;
  tier: 'strategist' | 'grandCru' | 'aiAgent';
  buttonText?: string;
}

const tierPrices = {
  strategist: '$9.99',
  grandCru: '$24.99',
  aiAgent: '$49.99'
};

export const StripeCheckout = ({ userId, tier, buttonText }: Props) => {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    const response = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, tier })
    });
    const { url } = await response.json();
    window.location.href = url;
  };

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className="w-full bg-fpl-green text-slate-950 font-black py-3 rounded-xl hover:bg-fpl-green/90 transition-all disabled:opacity-50"
    >
      {loading ? 'Processing...' : (buttonText || `Upgrade to ${tier} - ${tierPrices[tier]}/month`)}
    </button>
  );
};
