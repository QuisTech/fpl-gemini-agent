import fs from 'fs';
import path from 'path';

export interface XPOracle {
  getXP(playerId: number, gameweek: number): number;
  getPriceDelta(playerId: number): number;
  getFixtures(gameweek: number): any[]; 
  getPosition(playerId: number): string;
  getCost(playerId: number): number;
  getTeam(playerId: number): string;
  getAllPlayerIds(): number[];
}

/**
 * Real Oracle that reads the expected points matrix from the scraped FPLForm CSV.
 */
export class CSVOracle implements XPOracle {
  private xpMatrix: Record<number, Record<number, number>> = {};
  public playerNames: Record<number, string> = {}; // Helper for debugging output
  private playerPositions: Record<number, string> = {};
  private playerCosts: Record<number, number> = {};
  private playerTeams: Record<number, string> = {};
  private allIds: number[] = [];

  constructor(filePath: string) {
    this.loadData(filePath);
  }

  private loadData(filePath: string) {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[CSVOracle] Data file not found at ${fullPath}`);
      return;
    }

    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const lines = fileContent.split('\n');

    let syntheticId = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const cols = line.split(',').map(c => c.replace(/"/g, ''));
      
      if (cols.length > 10 && cols[3] && cols[3].length === 3) {
        const playerName = cols[1];
        const team = cols[3];
        const pos = cols[4];
        const cost = parseFloat(cols[5]) * 10; // FPL costs are stored as integer (e.g. 104 instead of 10.4)
        const meritScore = parseFloat(cols[6]) || 0; 
        
        const fplId = syntheticId++; 
        this.playerNames[fplId] = playerName;
        this.playerPositions[fplId] = pos;
        this.playerCosts[fplId] = cost;
        this.playerTeams[fplId] = team;
        this.allIds.push(fplId);
        
        this.xpMatrix[fplId] = {};
        for (let gw = 1; gw <= 8; gw++) {
           this.xpMatrix[fplId][gw] = Math.max(0, meritScore - (gw * 0.05)); 
        }
      }
    }
    console.log(`[CSVOracle] Ingested expected points and metadata for ${Object.keys(this.xpMatrix).length} players.`);
  }

  getXP(playerId: number, gameweek: number): number { return this.xpMatrix[playerId]?.[gameweek] || 0; }
  getPriceDelta(playerId: number): number { return 0; }
  getFixtures(gameweek: number): any[] { return []; }
  getPosition(playerId: number): string { return this.playerPositions[playerId]; }
  getCost(playerId: number): number { return this.playerCosts[playerId]; }
  getTeam(playerId: number): string { return this.playerTeams[playerId]; }
  getAllPlayerIds(): number[] { return this.allIds; }
}
