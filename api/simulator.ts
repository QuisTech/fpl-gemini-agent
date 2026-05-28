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

  public generateValidActions(state: SquadState): Action[] {
    const actions: Action[] = [];
    
    // 1. Always consider rolling
    if (state.freeTransfers < 5) {
      actions.push({ type: 'ROLL', hitCost: 0 });
    }

    // 2. Consider Chips
    if (state.chipState['WC'] > 0) {
      actions.push({ type: 'CHIP', chipName: 'WC', hitCost: 0 });
    }
    
    // Phase 2: For regular transfers, we will return a placeholder generic TRANSFER action 
    // to simulate taking a -4 hit, as a full combinatorial transfer generation 
    // requires a massive state expansion.
    actions.push({ type: 'TRANSFER', transfersIn: [], transfersOut: [], hitCost: 4 });

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
        const actions = this.generateValidActions(currentState);
        
        for (const action of actions) {
          const nextState: SquadState = {
            ...currentState,
            squad: [...currentState.squad],
            chipState: { ...currentState.chipState },
            freeTransfers: action.type === 'ROLL' ? Math.min(5, currentState.freeTransfers + 1) : currentState.freeTransfers,
            gameweek: gw + 1,
          };

          if (action.type === 'CHIP' && action.chipName) {
            nextState.activeChip = action.chipName;
            nextState.chipState[action.chipName] -= 1;
            
            if (action.chipName === 'WC') {
              // Execute the LP Solver to completely rebuild the squad!
              // Calculate current squad value + bank
              let squadValue = 0;
              nextState.squad.forEach(id => squadValue += oracle.getCost(id));
              const availableBudget = squadValue + nextState.bank;
              
              nextState.squad = solveOptimalSquad(oracle, gw, availableBudget);
              nextState.freeTransfers = 1; // Wildcard resets FTs
            }
          }

          if (action.type === 'TRANSFER') {
            nextState.freeTransfers = 1; // Used FTs
          }

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
