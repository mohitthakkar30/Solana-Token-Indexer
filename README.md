# Solana Token Transfer Indexer

A production-ready indexer for Solana token transfers using Helius APIs.

## Features

- ✅ Real-time streaming via Enhanced Websockets
- ✅ Historical backfilling via DAS API
- ✅ Idempotent processing (no duplicates)
- ✅ Automatic reconnection and failure recovery
- ✅ TimescaleDB optimization for time-series queries
- ✅ Supports SPL Token and Token-2022

## Prerequisites

1. **Node.js** (v18 or higher)
2. **PostgreSQL** (v12 or higher)
3. **TimescaleDB Extension** (for time-series optimization)
4. **Helius API Key** (get one at https://helius.dev)

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up PostgreSQL with TimescaleDB

#### On macOS (using Homebrew):
```bash
brew install timescaledb
brew services start postgresql
```

#### On Ubuntu/Debian:
```bash
sudo apt install postgresql postgresql-contrib
sudo apt install timescaledb-postgresql-14  # adjust version
sudo systemctl start postgresql
```


### 3. Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE token_index;

# Connect to the database
\c token_index

# Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

# Exit
\q
```

### 4. Run Database Schema

```bash
psql -U postgres -d token_index -f schema.sql
```

### 5. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit .env with your values
nano .env
```

**Required settings:**
```env
DB_HOST=your_host
DB_PORT=your_db_port
DB_NAME=token_index
DB_USER=your_postgres_user
HELIUS_API_KEY=your_helius_api_key_here
DB_PASSWORD=your_postgres_password
TOKEN_MINTS=token_address
BACKFILL_DAYS=number_of_days_for_backfill
```

## Usage

### Start the Indexer

```bash
npm start
```

This will:
1. Run historical backfill for the last 30 days
2. Start real-time streaming for new transfers
3. Display stats every 60 seconds

### Query Examples

```sql
-- Get recent USDC transfers
SELECT 
  signature,
  from_account,
  to_account,
  amount::NUMERIC / (10 ^ decimals) as amount_normalized,
  block_time
FROM token_transfers
WHERE mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  AND block_time > NOW() - INTERVAL '1 hour'
ORDER BY block_time DESC
LIMIT 10;

-- Get transfer statistics
SELECT * FROM transfer_stats;

-- Get account activity
SELECT 
  COUNT(*) as total_transfers,
  SUM(CASE WHEN from_account = 'YOUR_WALLET' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN to_account = 'YOUR_WALLET' THEN 1 ELSE 0 END) as received
FROM token_transfers
WHERE from_account = 'YOUR_WALLET' OR to_account = 'YOUR_WALLET';
```

## Configuration

### Monitored Tokens

Edit `TOKEN_MINTS` in `.env`:

```env
# Common tokens
TOKEN_MINTS=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
```

**Common Token Mints:**
- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- USDT: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`

### Backfill Period

Change `BACKFILL_DAYS` in `.env`:

```env
BACKFILL_DAYS=30  # Default is 30 days
```

## Architecture

```
Data Ingestion Layer
├── Real-time Stream (Enhanced Websockets)
└── Historical Backfill (DAS API)
         ↓
Processing & Storage Layer
├── Normalize token transfers
├── Deduplicate via (signature + index)
└── Store in TimescaleDB
```

## Monitoring

The indexer automatically logs:
- Connection status
- Transfers processed
- Errors and reconnections
- Database statistics

### Health Checks

```sql
-- Check if data is fresh (should be < 5 minutes)
SELECT 
  MAX(block_time) as last_transfer,
  EXTRACT(EPOCH FROM (NOW() - MAX(block_time))) / 60 as age_minutes
FROM token_transfers;
```

## Troubleshooting

### "Database connection failed"
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Verify credentials in `.env`
- Test connection: `psql -U postgres -d token_index`

### "WebSocket disconnects frequently"
- Check your internet connection
- Verify Helius API key is valid
- The indexer will automatically reconnect

### "No transfers being indexed"
- Verify TOKEN_MINTS are correct
- Ensure tokens have recent activity

### "Slow queries"
- Verify hypertables are created: `SELECT * FROM timescaledb_information.hypertables;`
- Check indexes exist: `\d token_transfers`
- Run `ANALYZE token_transfers;`

