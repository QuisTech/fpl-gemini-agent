import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FPLService } from './index';
import { FPLPlayer, FPLFixture } from './types';
import { CSVOracle, XPOracle } from './ingestion';
import { Simulator, SquadState } from './simulator';

// -------------------------------------------------------------
// 1. Mock Oracle implementation for isolated simulator tests
// -------------------------------------------------------------
class MockOracle implements XPOracle {
  private xpMatrix: Record<number, Record<number, number>> = {};
  private playerPositions: Record<number, string> = {};
  private playerCosts: Record<number, number> = {};
  private playerTeams: Record<number, string> = {};
  private allIds: number[] = [];

  constructor(players: { id: number; xp: number[]; pos: string; cost: number; team: string }[]) {
    players.forEach(p => {
      this.allIds.push(p.id);
      this.playerPositions[p.id] = p.pos;
      this.playerCosts[p.id] = p.cost;
      this.playerTeams[p.id] = p.team;
      this.xpMatrix[p.id] = {};
      p.xp.forEach((val, idx) => {
        this.xpMatrix[p.id][idx + 1] = val;
      });
    });
  }

  getXP(playerId: number, gameweek: number): number {
    return this.xpMatrix[playerId]?.[gameweek] || 0;
  }
  getPriceDelta(playerId: number): number { return 0; }
  getFixtures(gameweek: number): any[] { return []; }
  getPosition(playerId: number): string { return this.playerPositions[playerId]; }
  getCost(playerId: number): number { return this.playerCosts[playerId]; }
  getTeam(playerId: number): string { return this.playerTeams[playerId]; }
  getAllPlayerIds(): number[] { return this.allIds; }
}

// -------------------------------------------------------------
// 2. FPL Scoring Logic Tests (from V2)
// -------------------------------------------------------------
describe('FPLService - Scoring Logic', () => {
  const mockPlayer: FPLPlayer = {
    id: 1,
    web_name: 'Salah',
    first_name: 'Mohamed',
    second_name: 'Salah',
    now_cost: 125,
    element_type: 3, // MID
    team: 1,
    total_points: 200,
    form: '8.5',
    points_per_game: '7.5',
    selected_by_percent: '45.0',
    minutes: 2000,
    goals_scored: 15,
    assists: 10,
    clean_sheets: 8,
    status: 'a',
    news: '',
    chance_of_playing_next_round: 100,
    expected_goals: '0.8',
    expected_assists: '0.4',
    ict_index: '15.0'
  } as any;

  const mockFixtures: FPLFixture[] = [
    {
      id: 101,
      team_h: 1,
      team_a: 2,
      team_h_difficulty: 2,
      team_a_difficulty: 4,
      event: 30,
      finished: false
    }
  ];

  it('should calculate higher score for better fixtures', () => {
    const scoreEasy = FPLService.calculatePlayerScore(mockPlayer, mockFixtures, 30, 'safe');
    
    const hardFixtures: FPLFixture[] = [
      {
        id: 101,
        team_h: 1,
        team_a: 2,
        team_h_difficulty: 5,
        team_a_difficulty: 2,
        event: 30,
        finished: false
      }
    ];
    
    const scoreHard = FPLService.calculatePlayerScore(mockPlayer, hardFixtures, 30, 'safe');
    expect(scoreEasy).toBeGreaterThan(scoreHard);
  });

  it('should apply risk multiplier for differentials in aggressive mode', () => {
    const differentialPlayer = { ...mockPlayer, selected_by_percent: '4.9' };
    const scoreSafe = FPLService.calculatePlayerScore(differentialPlayer, mockFixtures, 30, 'safe');
    const scoreAggressive = FPLService.calculatePlayerScore(differentialPlayer, mockFixtures, 30, 'aggressive');
    
    expect(scoreAggressive).toBeGreaterThan(scoreSafe);
  });
});

// -------------------------------------------------------------
// 3. CSV Oracle Ingestion Tests
// -------------------------------------------------------------
describe('CSVOracle Ingestion & Strategy Multipliers', () => {
  const tempCsvPath = 'data/temp_test_fplform.csv';

  it('should parse player rows and apply risk mode multipliers correctly', () => {
    // 1. Create a temporary mock CSV (must have > 10 columns for CSVOracle to ingest)
    const csvContent = 
      `rank,player,id,team,position,cost,xp_gw1,xp_gw2,xp_gw3,dummy1,dummy2,dummy3,dummy4\n` +
      `1,Salah,1,LIV,MID,12.5,8.0,7.9,7.8,,,,,\n` +
      `2,Isak,2,NEW,FWD,8.5,6.0,5.9,5.8,,,,,\n` +
      `3,Mbeumo,3,BRE,MID,7.0,5.5,5.4,5.3,,,,,\n`;
    
    fs.mkdirSync(path.dirname(tempCsvPath), { recursive: true });
    fs.writeFileSync(tempCsvPath, csvContent, 'utf-8');

    const realPlayersMetadata = [
      { id: 300, web_name: 'Salah', selected_by_percent: '45.0' },
      { id: 450, web_name: 'Isak', selected_by_percent: '35.0' },
      { id: 600, web_name: 'Mbeumo', selected_by_percent: '4.2' } // Differential MID
    ];

    // Safe mode oracle
    const oracleSafe = new CSVOracle(tempCsvPath, realPlayersMetadata, 'safe');
    expect(oracleSafe.getAllPlayerIds()).toContain(300); // Mapped Salah
    expect(oracleSafe.getPosition(300)).toBe('MID');
    expect(oracleSafe.getCost(300)).toBe(125); // 12.5 * 10

    // Mbeumo is a differential (4.2% ownership)
    // Safe mode: no differential boost. Premium boost applies to Salah (£12.5m >= 10.0m: 1.15x) and Isak (£8.5m >= 8.0m: 1.08x)
    // Mbeumo: £7.0m -> no premium boost, no differential boost. Score = 5.5
    expect(oracleSafe.getXP(600, 1)).toBeCloseTo(5.5, 1);

    // Aggressive Mode: Mbeumo should receive 1.25x differential boost
    const oracleAggressive = new CSVOracle(tempCsvPath, realPlayersMetadata, 'aggressive');
    expect(oracleAggressive.getXP(600, 1)).toBeCloseTo(5.5 * 1.25, 1);

    // Clean up
    if (fs.existsSync(tempCsvPath)) {
      fs.unlinkSync(tempCsvPath);
    }
  });
});

// -------------------------------------------------------------
// 4. Simulator Accuracy & Matchday Calculations
// -------------------------------------------------------------
describe('Simulator - Matchday points calculations', () => {
  const mockPlayers = [
    { id: 1, xp: [8, 8], pos: 'MID', cost: 120, team: 'LIV' }, // Captain
    { id: 2, xp: [6, 6], pos: 'FWD', cost: 85, team: 'NEW' },  // Vice-Captain
    { id: 3, xp: [5, 5], pos: 'DEF', cost: 50, team: 'ARS' },
    { id: 4, xp: [4, 4], pos: 'DEF', cost: 45, team: 'MCI' },
    { id: 5, xp: [4, 4], pos: 'MID', cost: 65, team: 'MUN' },
    { id: 6, xp: [3, 3], pos: 'DEF', cost: 40, team: 'AVL' },
    { id: 7, xp: [3, 3], pos: 'MID', cost: 60, team: 'TOT' },
    { id: 8, xp: [3, 3], pos: 'FWD', cost: 75, team: 'CHE' },
    { id: 9, xp: [2, 2], pos: 'GKP', cost: 45, team: 'EVE' },
    { id: 10, xp: [2, 2], pos: 'DEF', cost: 42, team: 'BHA' },
    { id: 11, xp: [2, 2], pos: 'MID', cost: 55, team: 'WHU' },
    // Bench players:
    { id: 12, xp: [1.5, 1.5], pos: 'FWD', cost: 45, team: 'BRE' },
    { id: 13, xp: [1, 1], pos: 'DEF', cost: 38, team: 'BOU' },
    { id: 14, xp: [1, 1], pos: 'MID', cost: 44, team: 'CRY' },
    { id: 15, xp: [0.5, 0.5], pos: 'GKP', cost: 40, team: 'LEI' }
  ];

  const oracle = new MockOracle(mockPlayers);
  const simulator = new Simulator(true);

  const state: SquadState = {
    squad: mockPlayers.map(p => p.id),
    bank: 10,
    freeTransfers: 1,
    chipState: { 'WC': 1, 'FH': 1, 'BB': 1, 'TC': 1 },
    gameweek: 1,
    accumulatedScore: 0
  };

  it('should sum expected points for standard starting XI and double captain', () => {
    // Starting XI should be top 11 players. Top 11 sum:
    // id 1: 8.0 (doubled to 16.0)
    // id 2: 6.0
    // id 3: 5.0
    // id 4: 4.0
    // id 5: 4.0
    // id 6: 3.0
    // id 7: 3.0
    // id 8: 3.0
    // id 9: 2.0
    // id 10: 2.0
    // id 11: 2.0
    // Expected Sum = 16.0 + 6 + 5 + 4 + 4 + 3 + 3 + 3 + 2 + 2 + 2 = 50.0
    const points = simulator.simulateMatchday(state, 1, oracle);
    expect(points).toBeCloseTo(50.0, 1);
  });

  it('should sum expected points for all 15 squad players when Bench Boost is active', () => {
    const bbState = { ...state, activeChip: 'BB' };
    // Bench Boost adds all players:
    // Starters Sum: 50.0
    // Bench: id 12 (1.5), id 13 (1.0), id 14 (1.0), id 15 (0.5) = 4.0
    // Total = 50.0 + 4.0 = 54.0
    const points = simulator.simulateMatchday(bbState, 1, oracle);
    expect(points).toBeCloseTo(54.0, 1);
  });
});

// -------------------------------------------------------------
// 5. Transfer Generation & Cost Constraint Verification
// -------------------------------------------------------------
describe('Simulator - generateValidActions transfer logic', () => {
  const mockPlayers = [
    // Current Squad (IDs 1 to 15)
    { id: 1, xp: [2, 2], pos: 'MID', cost: 70, team: 'LIV' },
    { id: 2, xp: [2, 2], pos: 'MID', cost: 60, team: 'NEW' },
    { id: 3, xp: [2, 2], pos: 'MID', cost: 50, team: 'ARS' },
    { id: 4, xp: [2, 2], pos: 'MID', cost: 45, team: 'MCI' },
    { id: 5, xp: [2, 2], pos: 'MID', cost: 40, team: 'MUN' },
    { id: 6, xp: [2, 2], pos: 'DEF', cost: 50, team: 'AVL' },
    { id: 7, xp: [2, 2], pos: 'DEF', cost: 45, team: 'TOT' },
    { id: 8, xp: [2, 2], pos: 'DEF', cost: 40, team: 'CHE' },
    { id: 9, xp: [2, 2], pos: 'DEF', cost: 35, team: 'EVE' },
    { id: 10, xp: [2, 2], pos: 'DEF', cost: 35, team: 'BHA' },
    { id: 11, xp: [2, 2], pos: 'FWD', cost: 80, team: 'WHU' },
    { id: 12, xp: [2, 2], pos: 'FWD', cost: 70, team: 'BRE' },
    { id: 13, xp: [2, 2], pos: 'FWD', cost: 50, team: 'BOU' },
    { id: 14, xp: [2, 2], pos: 'GKP', cost: 45, team: 'CRY' },
    { id: 15, xp: [2, 2], pos: 'GKP', cost: 40, team: 'LEI' },
    // External candidates (IDs 16 to 18)
    { id: 16, xp: [6, 6], pos: 'MID', cost: 75, team: 'BRE' }, // Out of budget (70 + 3 bank < 75)
    { id: 17, xp: [8, 8], pos: 'MID', cost: 72, team: 'LIV' }, // Valid swap for MID 1 (cost 70 + 3 bank >= 72)
    { id: 18, xp: [9, 9], pos: 'DEF', cost: 48, team: 'MCI' }  // Valid swap for DEF 6 (cost 50 + 3 bank >= 48)
  ];

  const oracle = new MockOracle(mockPlayers);
  const simulator = new Simulator(true);

  const state: SquadState = {
    squad: mockPlayers.slice(0, 15).map(p => p.id),
    bank: 3, // £0.3m remaining
    freeTransfers: 1,
    chipState: { 'WC': 0, 'FH': 0, 'BB': 0, 'TC': 0 },
    gameweek: 1,
    accumulatedScore: 0
  };

  it('should recommend valid swaps that improve points and fit financial budget constraints', () => {
    const actions = simulator.generateValidActions(state, oracle, 1);
    const transfers = actions.filter(a => a.type === 'TRANSFER');

    // Should generate transfers
    expect(transfers.length).toBeGreaterThan(0);

    // Swap MID 1 (cost 70) -> Candidate 17 (cost 72, xp 8) should be recommended
    const swapMid = transfers.find(t => t.transfersOut?.includes(1) && t.transfersIn?.includes(17));
    expect(swapMid).toBeDefined();
    expect(swapMid?.hitCost).toBe(0); // Free transfer available

    // Swap MID 1 (cost 70) -> Candidate 16 (cost 75) should NOT be recommended (violates budget 70 + 3 < 75)
    const swapTooExpensive = transfers.find(t => t.transfersIn?.includes(16));
    expect(swapTooExpensive).toBeUndefined();

    // Swap DEF 6 (cost 50) -> Candidate 18 (cost 48, xp 9) should be recommended
    const swapDef = transfers.find(t => t.transfersOut?.includes(6) && t.transfersIn?.includes(18));
    expect(swapDef).toBeDefined();
  });
});

// -------------------------------------------------------------
// 6. Chip State Transitions & Beam Search Lookahead Correctness
// -------------------------------------------------------------
describe('Simulator - Multi-horizon beam search and state transitions', () => {
  const mockPlayers = [
    { id: 1, xp: [4, 4], pos: 'MID', cost: 60, team: 'LIV' },
    { id: 2, xp: [4, 4], pos: 'MID', cost: 60, team: 'NEW' },
    { id: 3, xp: [4, 4], pos: 'MID', cost: 60, team: 'ARS' },
    { id: 4, xp: [4, 4], pos: 'MID', cost: 60, team: 'MCI' },
    { id: 5, xp: [4, 4], pos: 'MID', cost: 60, team: 'MUN' },
    { id: 6, xp: [4, 4], pos: 'DEF', cost: 50, team: 'AVL' },
    { id: 7, xp: [4, 4], pos: 'DEF', cost: 50, team: 'TOT' },
    { id: 8, xp: [4, 4], pos: 'DEF', cost: 50, team: 'CHE' },
    { id: 9, xp: [4, 4], pos: 'DEF', cost: 50, team: 'EVE' },
    { id: 10, xp: [4, 4], pos: 'DEF', cost: 50, team: 'BHA' },
    { id: 11, xp: [4, 4], pos: 'FWD', cost: 80, team: 'WHU' },
    { id: 12, xp: [4, 4], pos: 'FWD', cost: 80, team: 'BRE' },
    { id: 13, xp: [4, 4], pos: 'FWD', cost: 80, team: 'BOU' },
    { id: 14, xp: [4, 4], pos: 'GKP', cost: 45, team: 'CRY' },
    { id: 15, xp: [4, 4], pos: 'GKP', cost: 45, team: 'LEI' },
    // A massive high-scoring candidate that fits within budget
    { id: 16, xp: [10, 10], pos: 'MID', cost: 55, team: 'LIV' }
  ];

  const oracle = new MockOracle(mockPlayers);
  const simulator = new Simulator(true); // Vercel mode runs maxDepth=8, beamWidth=50

  const state: SquadState = {
    squad: mockPlayers.slice(0, 15).map(p => p.id),
    bank: 5,
    freeTransfers: 1,
    chipState: { 'WC': 0, 'FH': 0, 'BB': 0, 'TC': 0 },
    gameweek: 1,
    accumulatedScore: 0
  };

  it('should successfully execute simulateHorizon beam search and suggest transfer actions', () => {
    const results = simulator.simulateHorizon(state, oracle);

    expect(results.length).toBeGreaterThan(0);
    
    // The top recommendation path should be calculated successfully
    const bestFuture = results[0];
    expect(bestFuture.accumulatedScore).toBeGreaterThan(0);

    // The first action of the optimal future should be recorded (either ROLL or TRANSFER)
    expect(bestFuture.firstAction).toBeDefined();
    expect(['ROLL', 'TRANSFER']).toContain(bestFuture.firstAction);
  });
});
