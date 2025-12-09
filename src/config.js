import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

export const config = {
  helius: {
    apiKey: process.env.HELIUS_API_KEY,
    wsUrl: 'wss://atlas-mainnet.helius-rpc.com',
    httpUrl: 'https://api.helius.xyz'
  },
  
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'token_index',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    max: 20, // connection pool size
  },
  
  indexer: {
    tokenMints: (process.env.TOKEN_MINTS || '').split(',').filter(Boolean),
    backfillDays: parseInt(process.env.BACKFILL_DAYS || '30'),
  }
};

// Validate required config
if (!config.helius.apiKey) {
  throw new Error('HELIUS_API_KEY is required in .env file');
}

if (!config.database.password) {
  console.warn('Warning: DB_PASSWORD not set in .env file');
}

if(!config.database.host) {
  console.warn('Warning: DB_HOST not set in .env file');
}

if(!config.database.user) {
  console.warn('Warning: DB_USER not set in .env file');
}

if(!config.database.database) {
  console.warn('Warning: DB_NAME not set in .env file');
}

if(!config.database.port) {
  console.warn('Warning: DB_PORT not set in .env file');
}

if (isNaN(config.indexer.backfillDays) || config.indexer.backfillDays <= 0) {
  console.warn('Warning: BACKFILL_DAYS is not a valid positive number. Defaulting to 30 days.');
  config.indexer.backfillDays = 30;
}

if (config.indexer.tokenMints.length === 0) {
  console.warn('Warning: No TOKEN_MINTS configured. Using USDC as default.');
  config.indexer.tokenMints = ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'];
}
