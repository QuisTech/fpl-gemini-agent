import solver from "javascript-lp-solver";
import { XPOracle } from "./ingestion";

interface LPSolverModel {
  optimize: string;
  opType: "max" | "min";
  constraints: Record<string, { max?: number; min?: number; equal?: number }>;
  variables: Record<string, Record<string, number>>;
  ints: Record<string, 1>;
}

export function solveOptimalSquad(oracle: XPOracle, gameweek: number, budget: number): number[] {
  const allIds = oracle.getAllPlayerIds();
  
  const model: LPSolverModel = {
    optimize: "score",
    opType: "max",
    constraints: { 
      cost: { max: budget }, 
      total: { equal: 15 }, 
      gkp: { equal: 2 }, 
      def: { equal: 5 }, 
      mid: { equal: 5 }, 
      fwd: { equal: 3 } 
    },
    variables: {},
    ints: {}
  };

  allIds.forEach(id => {
    const team = oracle.getTeam(id);
    if (!model.constraints[`team_${team}`]) {
      model.constraints[`team_${team}`] = { max: 3 };
    }

    const v = `p_${id}`;
    const pos = oracle.getPosition(id).toLowerCase(); // "gkp", "def", "mid", "fwd"
    const score = oracle.getXP(id, gameweek);
    const cost = oracle.getCost(id);

    // Only consider players who have a score > 0 to keep the model small
    if (score > 0) {
      model.variables[v] = { 
        score, 
        cost, 
        total: 1, 
        [pos]: 1, 
        [`team_${team}`]: 1, 
        [v]: 1 
      };
      model.constraints[v] = { max: 1 };
      model.ints[v] = 1;
    }
  });

  const solution = solver.Solve(model) as Record<string, any>;
  
  const squadIds: number[] = [];
  for (const key in solution) {
    if (key.startsWith('p_')) {
      const val = solution[key];
      if (val === true || val === 1 || (typeof val === 'number' && val > 0.5)) {
        squadIds.push(parseInt(key.replace('p_', '')));
      }
    }
  }

  return squadIds;
}
