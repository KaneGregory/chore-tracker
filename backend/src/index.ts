import 'dotenv/config';
import { runMigrations } from './db/client.js';
import { createApp } from './app.js';
import { startDailyReminderScheduler } from './services/dailyReminderScheduler.js';
import { startChoreScheduler } from './services/choreScheduler.js';

runMigrations();

const app = createApp();
const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`chore-tracker backend listening on port ${port}`);
});

// Started here, not in createApp() — every test file calls createApp() to build an
// in-memory Express instance, and none of them should spin up a real recurring
// interval (leaked across tests, checking chores against whatever tmp db happens to
// exist at that moment).
startDailyReminderScheduler();

// Same reasoning as startDailyReminderScheduler above: started here, not in
// createApp(), so no test spins up a real recurring interval.
startChoreScheduler();
