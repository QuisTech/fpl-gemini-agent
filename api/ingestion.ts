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

  constructor(filePath: string, players: any[] = [], riskMode: string = 'safe') {
    this.loadData(filePath, players, riskMode);
  }

  private loadData(filePath: string, players: any[], riskMode: string) {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[CSVOracle] Data file not found at ${fullPath}`);
      return;
    }

    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const lines = fileContent.split('\n');

    let syntheticId = 9000;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const cols = line.split(',').map(c => c.replace(/"/g, ''));
      
      if (cols.length > 10 && cols[3] && cols[3].length === 3) {
        const playerName = cols[1];
        const team = cols[3];
        const pos = cols[4];
        const cost = parseFloat(cols[5]) * 10; 
        const meritScore = parseFloat(cols[6]) || 0; 
        
        // Match player name to real FPL ID
        let fplId = syntheticId++; 
        let rawOwnership = 100.0; // default safe value
        if (players.length > 0) {
          const match = players.find(p => 
            p.web_name?.toLowerCase() === playerName.toLowerCase() ||
            p.second_name?.toLowerCase().includes(playerName.toLowerCase()) ||
            playerName.toLowerCase().includes(p.second_name?.toLowerCase()) ||
            playerName.toLowerCase().includes(p.web_name?.toLowerCase())
          );
          if (match) {
            fplId = match.id;
            rawOwnership = parseFloat(match.selected_by_percent) || 100.0;
          }
        }
        
        let adjustedMerit = meritScore;

        // Apply Strategy Mode Logic
        if (riskMode !== 'value') {
          // Risky Mode: Boost massive differentials (< 5% ownership)
          if (riskMode === 'aggressive' && rawOwnership < 5.0) {
            adjustedMerit *= 1.25; 
          }
          
          // Premium Captaincy Protection: Expensive players are captained often
          const costInMillions = cost / 10;
          if (costInMillions >= 10.0) {
            adjustedMerit *= 1.15;
          } else if (costInMillions >= 8.0) {
            adjustedMerit *= 1.08;
          }
        }

        this.playerNames[fplId] = playerName;
        this.playerPositions[fplId] = pos;
        this.playerCosts[fplId] = cost;
        this.playerTeams[fplId] = team;
        this.allIds.push(fplId);
        
        this.xpMatrix[fplId] = {};
        for (let gw = 1; gw <= 8; gw++) {
           this.xpMatrix[fplId][gw] = Math.max(0, adjustedMerit - (gw * 0.05)); 
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
