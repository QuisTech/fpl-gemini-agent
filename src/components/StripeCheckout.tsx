import { useState } from 'react';
import { cn } from '../lib/utils';

interface Props {
  userId: string;
  tier: 'strategist' | 'grandCru' | 'aiAgent';
  buttonText?: string;
  className?: string;
}

const tierPrices = {
  strategist: '$9.99',
  grandCru: '$24.99',
  aiAgent: '$49.99'
};

const paymentLinks = {
  strategist: 'https://checkout.dodopayments.com/session/cks_0NgQgZyt3EeoTj2DnZGSy',
  grandCru: 'https://checkout.dodopayments.com/session/cks_0NgQggYVpAp38tKpJAt7o',
  aiAgent: 'https://checkout.dodopayments.com/session/cks_0NgQgmS8TLNbOn0XMsxLV'
};

export const StripeCheckout = ({ userId, tier, buttonText, className }: Props) => {
  const [loading, setLoading] = useState(false);

  const handleCheckout = () => {
    setLoading(true);
    // Append userId to the checkout link if Dodopayments supports tracking it
    const baseUrl = paymentLinks[tier];
    window.location.href = baseUrl;
  };

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className={cn(
        className || "w-full bg-fpl-green text-slate-950 font-black py-3 rounded-xl hover:bg-fpl-green/90 transition-all disabled:opacity-50"
      )}
    >
      {loading ? 'Processing...' : (buttonText || `Upgrade to ${tier} - ${tierPrices[tier]}/month`)}
    </button>
  );
};
