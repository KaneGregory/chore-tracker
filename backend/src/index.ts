import 'dotenv/config';
import { runMigrations } from './db/client.js';
import { createApp } from './app.js';

runMigrations();

const app = createApp();
const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`chore-tracker backend listening on port ${port}`);
});
