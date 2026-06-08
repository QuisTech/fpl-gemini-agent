export type OptimizerTierId = 'free' | 'strategist' | 'grandCru' | 'betaPilot';

export interface OptimizerPlan {
  id: OptimizerTierId;
  name: string;
  price: string;
  cadence: string;
  audience: string;
  summary: string;
  cta: string;
  featured?: boolean;
  features: string[];
}

export const optimizerPlans: OptimizerPlan[] = [
  {
    id: 'free',
    name: 'Free Scout',
    price: 'GBP 0',
    cadence: 'forever',
    audience: 'Curious managers',
    summary: 'A fast taste of the model for weekly squad discovery.',
    cta: 'Start free',
    features: [
      'Safe-mode recommendations',
      '1 gameweek squad view',
      'Top picks by position',
      'Performance snapshots'
    ]
  },
  {
    id: 'strategist',
    name: 'Horizon Strategist',
    price: 'GBP 9.99',
    cadence: 'per month',
    audience: 'Active mini-league players',
    summary: 'The original LP engine packaged for practical weekly decisions.',
    cta: 'Upgrade to Strategist',
    features: [
      'Linear-programmed optimal squad',
      'Safe, Risky, and Value modes',
      'Team sync and 1-for-1 transfers',
      'Rules-based chip guidance'
    ]
  },
  {
    id: 'grandCru',
    name: 'Horizon Grand Cru',
    price: 'GBP 24.99',
    cadence: 'per month',
    audience: 'Serious rank climbers',
    summary: 'The V3 multiverse engine for 8-gameweek transfer and chip planning.',
    cta: 'Unlock Grand Cru',
    features: [
      '8-gameweek beam-search simulation',
      'Multi-transfer LP optimization',
      'Variance-aware risk modeling',
      'Autonomous chip state machine'
    ]
  },
  {
    id: 'betaPilot',
    name: 'AI Optimizer Agent',
    price: 'GBP 49.99',
    cadence: 'per month',
    audience: 'Hardcore rank maximizers',
    summary: 'The flagship Hybrid FPL Agent combining LLM reasoning with mathematical simulation.',
    cta: 'Become a Beta Pilot',
    featured: true,
    features: [
      'Conversational AI Chat Interface',
      'Press conference & injury news parser',
      'Interactive transfer path scenarios',
      'Autonomous team planner and advisor',
      '24/7 deadline notifications',
      'Priority solver queue access'
    ]
  }
];

export const tierFeatureMatrix = [
  { feature: 'Optimal squad', free: 'Basic', strategist: 'LP', grandCru: 'LP + horizon', betaPilot: 'LP + Multiverse' },
  { feature: 'Team sync', free: 'Locked', strategist: 'Included', grandCru: 'Included', betaPilot: 'Included' },
  { feature: 'Transfer logic', free: 'Locked', strategist: '1-for-1', grandCru: 'Multi-transfer', betaPilot: 'Multi-transfer' },
  { feature: 'Chip advice', free: 'Locked', strategist: 'Rules', grandCru: 'Simulated', betaPilot: 'Simulated' },
  { feature: 'Lookahead', free: '1 GW', strategist: '1 GW', grandCru: '8 GWs', betaPilot: '8 GWs' },
  { feature: 'AI Conversational Chat', free: 'Locked', strategist: 'Locked', grandCru: 'Locked', betaPilot: 'Included' },
  { feature: 'Injury & News Parser', free: 'Locked', strategist: 'Locked', grandCru: 'Locked', betaPilot: 'Included' }
];
