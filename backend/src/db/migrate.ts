import 'dotenv/config';
import { runMigrations } from './client.js';

runMigrations();
console.log('Migrations applied.');
