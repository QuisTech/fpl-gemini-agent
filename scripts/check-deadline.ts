import fetch from 'node-fetch';

const FPL_BASE_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

(async () => {
  try {
    const response = await fetch(FPL_BASE_URL);
    const data = await response.json() as any;
    
    // Find the next upcoming gameweek
    const nextEvent = data.events.find((e: any) => e.is_next);
    
    if (!nextEvent) {
      console.log('[Deadline Sniper] No upcoming gameweek found. Sleeping.');
      process.exit(1);
    }

    const deadlineTime = new Date(nextEvent.deadline_time).getTime();
    const now = Date.now();
    
    // Calculate difference in hours
    const hoursUntilDeadline = (deadlineTime - now) / (1000 * 60 * 60);

    console.log(`[Deadline Sniper] Gameweek ${nextEvent.id} deadline is in ${hoursUntilDeadline.toFixed(2)} hours.`);

    // If the deadline is exactly between 1 and 2 hours away, we pull the trigger!
    // (Since this script runs once an hour, it will only ever hit this window exactly once per gameweek)
    if (hoursUntilDeadline > 1 && hoursUntilDeadline <= 2) {
      console.log('✅ [Deadline Sniper] GOLDEN WINDOW REACHED! Time to fetch the live data.');
      process.exit(0); // Exit 0 tells GitHub Actions to proceed to the next step
    } else {
      console.log('⏳ [Deadline Sniper] Not in the window. Going back to sleep.');
      process.exit(1); // Exit 1 tells GitHub Actions to abort the rest of the workflow silently
    }
  } catch (err: any) {
    console.error('Error fetching FPL API:', err.message);
    process.exit(1);
  }
})();
