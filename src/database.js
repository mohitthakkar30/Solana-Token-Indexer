import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export class Database {
  constructor() {
    this.pool = new Pool(config.database);
    this.pool.on('error', (err) => {
      console.error('Unexpected database error:', err);
    });
  }

  async connect() {
    try {
      const client = await this.pool.connect();
      console.log('✓ Database connected successfully');
      client.release();
      return true;
    } catch (error) {
      console.error('✗ Database connection failed:', error.message);
      return false;
    }
  }

  async query(text, params) {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(`Slow query (${duration}ms):`, text.substring(0, 50));
      }
      return result;
    } catch (error) {
      console.error('Query error:', error.message);
      throw error;
    }
  }

  async insertTransfer(transfer) {
    return this.query(`
      INSERT INTO token_transfers
      (signature, instruction_index, block_time, slot, mint, from_account, to_account, amount, decimals)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (signature, instruction_index, block_time) DO NOTHING
      RETURNING signature
    `, [
      transfer.signature,
      transfer.instructionIndex,
      transfer.blockTime,
      transfer.slot,
      transfer.mint,
      transfer.from,
      transfer.to,
      transfer.amount.toString(),
      transfer.decimals
    ]);
  }

  async getLastTransferTime() {
    const result = await this.query(`
      SELECT MAX(block_time) as last_time FROM token_transfers
    `);
    return result.rows[0]?.last_time;
  }

  async getTransferCount() {
    const result = await this.query(`
      SELECT COUNT(*) as count FROM token_transfers
    `);
    return parseInt(result.rows[0].count);
  }

  async getStats() {
    const result = await this.query(`
      SELECT 
        COUNT(*) as total_transfers,
        COUNT(DISTINCT mint) as unique_mints,
        COUNT(DISTINCT from_account) as unique_senders,
        COUNT(DISTINCT to_account) as unique_receivers,
        MIN(block_time) as first_transfer,
        MAX(block_time) as last_transfer
      FROM token_transfers
    `);
    return result.rows[0];
  }

  async updateBackfillProgress(mint, cursor, processed) {
    return this.query(`
      INSERT INTO backfill_progress (mint, last_cursor, last_processed_at, total_processed, status)
      VALUES ($1, $2, NOW(), $3, 'in_progress')
      ON CONFLICT (mint) 
      DO UPDATE SET 
        last_cursor = $2,
        last_processed_at = NOW(),
        total_processed = backfill_progress.total_processed + $3,
        status = 'in_progress'
    `, [mint, cursor, processed]);
  }

  async close() {
    await this.pool.end();
    console.log('Database connection closed');
  }
}
