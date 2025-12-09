-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Main token transfers table
CREATE TABLE IF NOT EXISTS token_transfers (
    signature VARCHAR(88) NOT NULL,
    instruction_index INTEGER NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    slot BIGINT NOT NULL,
    mint VARCHAR(44) NOT NULL,
    from_account VARCHAR(44),
    to_account VARCHAR(44),
    amount NUMERIC(20, 0) NOT NULL,
    decimals INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Composite primary key for idempotency (includes block_time for TimescaleDB)
    PRIMARY KEY (signature, instruction_index, block_time)
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('token_transfers', 'block_time', if_not_exists => TRUE);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_mint_time ON token_transfers (mint, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_from_time ON token_transfers (from_account, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_to_time ON token_transfers (to_account, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_time ON token_transfers (block_time DESC);
CREATE INDEX IF NOT EXISTS idx_slot ON token_transfers (slot DESC);

-- Auto-delete data older than 30 days
SELECT add_retention_policy('token_transfers', INTERVAL '30 days', if_not_exists => TRUE);

-- Compress data older than 7 days (saves 90% storage)
SELECT add_compression_policy('token_transfers', INTERVAL '7 days', if_not_exists => TRUE);

-- Backfill progress tracking table
CREATE TABLE IF NOT EXISTS backfill_progress (
    mint VARCHAR(44) PRIMARY KEY,
    last_cursor VARCHAR(255),
    last_processed_at TIMESTAMPTZ,
    total_processed INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending' -- pending, in_progress, completed, failed
);

-- Create a view for easy monitoring
CREATE OR REPLACE VIEW transfer_stats AS
SELECT 
    mint,
    COUNT(*) as total_transfers,
    COUNT(DISTINCT from_account) as unique_senders,
    COUNT(DISTINCT to_account) as unique_receivers,
    MIN(block_time) as first_transfer,
    MAX(block_time) as last_transfer
FROM token_transfers
GROUP BY mint;

-- Grant permissions (adjust user as needed)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_user;

COMMENT ON TABLE token_transfers IS 'Stores token transfer events from Solana blockchain';
COMMENT ON COLUMN token_transfers.signature IS 'Transaction signature (unique identifier)';
COMMENT ON COLUMN token_transfers.instruction_index IS 'Position of transfer within transaction';
COMMENT ON COLUMN token_transfers.mint IS 'Token mint address';
