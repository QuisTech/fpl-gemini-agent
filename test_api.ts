import { FPLService } from './api/index.js';

(async () => {
  try {
    console.log('Testing V3 Endpoint Integration...');
    // Replace 994112 with any real FPL team ID, using a dummy 1 for test
    const response = await FPLService.syncTeam('1', 'safe');
    
    console.log('\n--- V3 Engine Output ---');
    console.log(`Transfers Suggested: ${response.transfers.length > 0 ? 'YES' : 'ROLL'}`);
    response.chips.forEach(c => {
      if (c.recommendation === 'STRONG BUY') {
        console.log(`🔥 ENGINE TRIGGERED CHIP: ${c.chip}`);
        console.log(`   Reason: ${c.reason}`);
      }
    });

  } catch (err: any) {
    console.error('Test Failed:', err.message);
  }
})();
