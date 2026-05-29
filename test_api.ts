import { FPLService } from './api/index.js';

(async () => {
  try {
    console.log('Testing V3 Endpoint Integration with team ID 3018660...');
    const response = await FPLService.syncTeam('3018660', 'safe');
    
    console.log('\n--- V3 Engine Output ---');
    console.log(`Transfers Suggested: ${response.transfers.length > 0 ? 'YES' : 'ROLL'}`);
    response.chips.forEach(c => {
      if (c.recommendation === 'STRONG BUY') {
        console.log(`🔥 ENGINE TRIGGERED CHIP: ${c.chip}`);
        console.log(`   Reason: ${c.reason}`);
      }
    });

  } catch (err: any) {
    console.error('Test Failed:', err);
  }
})();
