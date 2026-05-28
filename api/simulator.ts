import { XPOracle } from './ingestion.js';
import { solveOptimalSquad } from './lp-solver.js';

export interface SquadState {
  squad: number[]; // Array of 15 player IDs
  bank: number;
  freeTransfers: number;
  chipState: Record<string, number>; // e.g. { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 }
  gameweek: number;
  accumulatedScore: number;
  activeChip?: string; // e.g. 'WC' active for this week
  firstAction?: string; // Tracks initial step 0 action (ROLL, TRANSFER, WC, etc.)
}

export interface Action {
  type: 'ROLL' | 'TRANSFER' | 'CHIP';
  transfersIn?: number[];
  transfersOut?: number[];
  chipName?: string;
  hitCost: number;
}

export class Simulator {
  private beamWidth: number;
  private maxDepth: number;

  constructor(isVercel: boolean = false) {
    if (isVercel) {
      this.beamWidth = 50;
      this.maxDepth = 8;
    } else {
      this.beamWidth = 500;
      this.maxDepth = 8;
    }
  }

  public simulateMatchday(state: SquadState, gw: number, oracle: XPOracle): number {
    const playerProjections = state.squad.map(id => ({
      id,
      xp: oracle.getXP(id, gw),
      pos: oracle.getPosition(id)
    }));

    playerProjections.sort((a, b) => b.xp - a.xp);

    let gwScore = 0;
    if (playerProjections.length > 0) {
      // Triple Captain Chip Check
      if (state.activeChip === 'TC') {
        gwScore += playerProjections[0].xp * 3;
      } else {
        gwScore += playerProjections[0].xp * 2;
      }
    }

    // Bench Boost check: Add all 15 players
    const startersCount = state.activeChip === 'BB' ? 15 : 11;
    for (let i = 1; i < Math.min(startersCount, playerProjections.length); i++) {
      gwScore += playerProjections[i].xp;
    }

    return gwScore;
  }

  public calculateFitness(state: SquadState): number {
    return state.accumulatedScore;
  }

  public generateValidActions(state: SquadState, oracle: XPOracle, gw: number): Action[] {
    const actions: Action[] = [];
    
    // 1. Always consider rolling (doing nothing)
    actions.push({ type: 'ROLL', hitCost: 0 });

    // 2. Consider Chips
    if (state.chipState['WC'] > 0) {
      actions.push({ type: 'CHIP', chipName: 'WC', hitCost: 0 });
    }
    
    // 3. Generate valid single transfers (1-for-1 swaps)
    const squadSet = new Set(state.squad);
    const candidateIds = oracle.getAllPlayerIds();
    const potentialSwaps: { outId: number; inId: number; diff: number }[] = [];

    state.squad.forEach(outId => {
      const outPos = oracle.getPosition(outId);
      const outCost = oracle.getCost(outId);
      const outXP = oracle.getXP(outId, gw);

      candidateIds.forEach(inId => {
        if (squadSet.has(inId)) return;
        if (oracle.getPosition(inId) !== outPos) return;

        const inCost = oracle.getCost(inId);
        if (inCost > outCost + state.bank) return;

        const inXP = oracle.getXP(inId, gw);
        const diff = inXP - outXP;
        
        if (diff > 0.2) { // Only consider meaningful expected points improvements
          potentialSwaps.push({ outId, inId, diff });
        }
      });
    });

    // Sort by expected points improvement and take top 5
    potentialSwaps.sort((a, b) => b.diff - a.diff);
    const topSwaps = potentialSwaps.slice(0, 5);

    topSwaps.forEach(swap => {
      actions.push({
        type: 'TRANSFER',
        transfersIn: [swap.inId],
        transfersOut: [swap.outId],
        hitCost: state.freeTransfers > 0 ? 0 : 4
      });
    });

    return actions;
  }

  public simulateHorizon(initialState: SquadState, oracle: XPOracle): SquadState[] {
    let currentBeam = [initialState];

    for (let step = 0; step < this.maxDepth; step++) {
      const gw = initialState.gameweek + step;
      let nextBeam: SquadState[] = [];

      for (const state of currentBeam) {
        // Reset active chip from previous week
        const currentState = { ...state, activeChip: undefined };
        const actions = this.generateValidActions(currentState, oracle, gw);
        
        for (const action of actions) {
          const nextState: SquadState = {
            ...currentState,
            squad: [...currentState.squad],
            chipState: { ...currentState.chipState },
            gameweek: gw + 1,
            accumulatedScore: currentState.accumulatedScore
          };

          // Track first action of trajectory
          if (step === 0) {
            nextState.firstAction = action.type === 'CHIP' ? action.chipName : action.type;
          } else {
            nextState.firstAction = currentState.firstAction;
          }

          if (action.type === 'CHIP' && action.chipName) {
            nextState.activeChip = action.chipName;
            nextState.chipState[action.chipName] -= 1;
            
            if (action.chipName === 'WC') {
              // Execute the LP Solver to completely rebuild the squad
              let squadValue = 0;
              nextState.squad.forEach(id => squadValue += oracle.getCost(id));
              const availableBudget = squadValue + nextState.bank;
              
              nextState.squad = solveOptimalSquad(oracle, gw, availableBudget);
              nextState.freeTransfers = 1; // Wildcard resets FTs
            }
          }

          if (action.type === 'TRANSFER' && action.transfersIn && action.transfersOut) {
            // Apply player swap
            nextState.squad = nextState.squad.map(id => 
              action.transfersOut!.includes(id) ? action.transfersIn![0] : id
            );
            
            // Update bank
            const costOut = action.transfersOut.reduce((sum, id) => sum + oracle.getCost(id), 0);
            const costIn = action.transfersIn.reduce((sum, id) => sum + oracle.getCost(id), 0);
            nextState.bank = nextState.bank + costOut - costIn;
          }

          // Calculate next week's free transfers
          const usedFTs = action.type === 'TRANSFER' ? 1 : 0;
          const remainingFTs = Math.max(0, currentState.freeTransfers - usedFTs);
          nextState.freeTransfers = Math.min(5, remainingFTs + 1);

          // Simulate Matchday
          const gwPoints = this.simulateMatchday(nextState, gw, oracle);
          nextState.accumulatedScore += gwPoints - action.hitCost;

          nextBeam.push(nextState);
        }
      }

      nextBeam.sort((a, b) => this.calculateFitness(b) - this.calculateFitness(a));
      currentBeam = nextBeam.slice(0, this.beamWidth);
    }

    return currentBeam;
  }
}
