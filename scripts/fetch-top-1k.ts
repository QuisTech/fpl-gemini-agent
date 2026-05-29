import axios from 'axios';
import fs from 'fs';
import path from 'path';

const FPL_BASE_URL = 'https://fantasy.premierleague.com/api';
const LEAGUE_ID = process.env.FPL_LEAGUE_ID || '314'; // Default to Overall League
const PAGES_TO_SCAN = parseInt(process.env.FPL_PAGES_TO_SCAN || '10'); // Default to 10 pages (500 managers)
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// Fetch with retry and exponential backoff
async function fetchWithRetry(url: string, retries = 3, delay = 2000): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { headers, timeout: 5000 });
      return response.data;
    } catch (err: any) {
      const status = err.response?.status;
      console.warn(`[Fetch] Attempt ${i + 1}/${retries} failed for ${url}: ${status || err.message}`);
      
      if (status === 404) {
        // If 404, the manager might not have played this GW or does not exist
        return null;
      }
      
      if (i < retries - 1) {
        await sleep(delay * Math.pow(2, i));
      } else {
        throw err;
      }
    }
  }
}

async function run() {
  console.log('[Top 1K Fetcher] Starting Top 1,000 FPL Manager Scan...');
  
  try {
    // 1. Fetch nextEventId to determine previous completed GW (deadline picks lock bypass)
    console.log('[Top 1K Fetcher] Fetching bootstrap-static...');
    const bootstrap = await fetchWithRetry(`${FPL_BASE_URL}/bootstrap-static/`);
    const nextEvent = bootstrap.events.find((e: any) => new Date(e.deadline_time) > new Date());
    const nextEventId = nextEvent ? nextEvent.id : 1;
    const currentGW = Math.max(1, nextEventId - 1);
    
    console.log(`[Top 1K Fetcher] Current Completed Gameweek: GW${currentGW} (next is GW${nextEventId})`);
    
    // 2. Fetch manager IDs from Standings pages
    const managerIds: number[] = [];
    const targetCount = PAGES_TO_SCAN * 50;
    console.log(`[Top 1K Fetcher] Retrieving Top ${targetCount} manager IDs from League ${LEAGUE_ID} (pages 1 to ${PAGES_TO_SCAN})...`);
    for (let page = 1; page <= PAGES_TO_SCAN; page++) {
      const standingsUrl = `${FPL_BASE_URL}/leagues-classic/${LEAGUE_ID}/standings/?page_standings=${page}`;
      const standingsData = await fetchWithRetry(standingsUrl);
      if (standingsData && standingsData.standings && standingsData.standings.results) {
        standingsData.standings.results.forEach((res: any) => {
          if (res.entry) {
            managerIds.push(res.entry);
          }
        });
      }
      // Be polite to FPL server
      await sleep(200);
    }
    
    console.log(`[Top 1K Fetcher] ✅ Successfully gathered ${managerIds.length} manager IDs.`);
    
    if (managerIds.length === 0) {
      console.error('[Top 1K Fetcher] ❌ No manager IDs found. Exiting.');
      process.exit(1);
    }
    
    // 3. Scan picks for all managers in batches
    const playerTallies: Record<number, { ownership: number; started: number; captain: number; tripleCaptain: number }> = {};
    let scannedCount = 0;
    let failedCount = 0;
    
    console.log(`[Top 1K Fetcher] Fetching picks for GW${currentGW} in batches of ${BATCH_SIZE}...`);
    
    for (let i = 0; i < managerIds.length; i += BATCH_SIZE) {
      const batch = managerIds.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (id) => {
        const url = `${FPL_BASE_URL}/entry/${id}/event/${currentGW}/picks/`;
        try {
          const pickData = await fetchWithRetry(url, 3, 1000);
          if (pickData && pickData.picks) {
            if (pickData.active_chip === 'freehit') {
              console.log(`[Top 1K Fetcher] Entry ${id} used Free Hit in GW${currentGW}. Skipping to avoid reversion noise.`);
              return;
            }
            pickData.picks.forEach((p: any) => {
              const pId = p.element;
              const isStarter = p.position <= 11;
              const multiplier = p.multiplier;
              
              if (!playerTallies[pId]) {
                playerTallies[pId] = { ownership: 0, started: 0, captain: 0, tripleCaptain: 0 };
              }
              
              playerTallies[pId].ownership += 1;
              if (isStarter) {
                playerTallies[pId].started += 1;
              }
              if (multiplier === 2) {
                playerTallies[pId].captain += 1;
              } else if (multiplier === 3) {
                playerTallies[pId].tripleCaptain += 1;
              }
            });
            scannedCount++;
          } else {
            failedCount++;
          }
        } catch (err: any) {
          console.warn(`[Top 1K Fetcher] Skipping entry ${id} due to fetch error.`);
          failedCount++;
        }
      });
      
      await Promise.all(promises);
      
      // Update progress
      if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= managerIds.length) {
        console.log(`[Progress] Scanned ${Math.min(i + BATCH_SIZE, managerIds.length)}/${managerIds.length} manager picks...`);
      }
      
      await sleep(BATCH_DELAY_MS);
    }
    
    console.log(`[Top 1K Fetcher] Scan Complete. Scanned: ${scannedCount}, Failed: ${failedCount}`);
    
    // 4. Calculate final percentages and construct output JSON
    const finalPlayers: Record<number, { name: string; ownership: number; started: number; eo: number; captain: number; tripleCaptain: number }> = {};
    
    // Construct a name lookup map using bootstrap elements
    const nameMap: Record<number, string> = {};
    bootstrap.elements.forEach((el: any) => {
      nameMap[el.id] = el.web_name;
    });
    
    const sampleSize = scannedCount || 1; // Prevent division by zero
    
    Object.keys(playerTallies).forEach((pIdStr) => {
      const pId = parseInt(pIdStr);
      const tally = playerTallies[pId];
      
      const ownershipPercent = parseFloat(((tally.ownership / sampleSize) * 100).toFixed(1));
      const startedPercent = parseFloat(((tally.started / sampleSize) * 100).toFixed(1));
      const captainPercent = parseFloat(((tally.captain / sampleSize) * 100).toFixed(1));
      const tripleCaptainPercent = parseFloat(((tally.tripleCaptain / sampleSize) * 100).toFixed(1));
      
      // EO calculation: multiplier sum divided by sample size * 100
      const totalMultipliers = tally.started + tally.captain + (tally.tripleCaptain * 2);
      const eoPercent = parseFloat(((totalMultipliers / sampleSize) * 100).toFixed(1));
      
      finalPlayers[pId] = {
        name: nameMap[pId] || 'Unknown',
        ownership: ownershipPercent,
        started: startedPercent,
        eo: eoPercent,
        captain: captainPercent,
        tripleCaptain: tripleCaptainPercent
      };
    });
    
    const outputData = {
      gameweek: currentGW,
      lastUpdated: Date.now(),
      sampleSize: scannedCount,
      players: finalPlayers
    };
    
    const destDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    const destPath = path.join(destDir, 'top_1000_eo.json');
    fs.writeFileSync(destPath, JSON.stringify(outputData, null, 2));
    
    console.log(`[Top 1K Fetcher] ✅ Successfully saved Top 1,000 manager EO data to: ${destPath}`);
  } catch (error: any) {
    console.error('[Top 1K Fetcher] ❌ Fatal error running scanner:', error.message);
    process.exit(1);
  }
}

run();
