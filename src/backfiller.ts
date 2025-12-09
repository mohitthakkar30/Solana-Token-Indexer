import { config } from "./config.js";
import { Database } from "./database.js";

export class HistoricalBackfiller {
  db: Database;
  stats: { totalProcessed: number; errors: number };
  constructor(database: Database) {
    this.db = database;
    this.stats = {
      totalProcessed: 0,
      errors: 0,
    };
  }

  async backfill(mint: string | any[], daysBack = 30) {
    console.log(`\n📚 Starting backfill for ${mint.slice(0, 8)}...`);
    console.log(`Fetching ${daysBack} days of history`);

    const targetTimestamp =
      Math.floor(Date.now() / 1000) - daysBack * 24 * 60 * 60;

    let beforeSignature = undefined;
    let totalProcessed = 0;
    let page = 0;
    let oldestTimestamp = Math.floor(Date.now() / 1000);

    try {
      do {
        const url = `${config.helius.httpUrl}/v0/addresses/${mint}/transactions`;
        const params = new URLSearchParams();

        if (config.helius.apiKey) {
          params.append("api-key", config.helius.apiKey);
        }
        params.append("limit", "100");

        if (beforeSignature) {
          params.append("before", beforeSignature);
        }

        const response = await fetch(`${url}?${params}`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();

        if (!data || !data.length) {
          console.log("No more transactions found");
          break;
        }

        // Check if we've gone back far enough
        const oldestInBatch = data[data.length - 1];
        oldestTimestamp =
          oldestInBatch.timestamp || oldestInBatch.blockTime || 0;

        // Process batch
        const processed = await this.processBatch(data, mint);
        totalProcessed += processed;
        page++;

        console.log(
          `Page ${page}: Processed ${processed} transactions (Total: ${totalProcessed})`
        );

        // Stop if we've reached the target date
        if (oldestTimestamp < targetTimestamp) {
          console.log(`Reached target date (${daysBack} days back)`);
          break;
        }

        // Use last signature as cursor for next page
        beforeSignature = oldestInBatch.signature;

        // Rate limiting
        await this.sleep(100);
      } while (beforeSignature && page < 1000); // Safety limit

      // Update backfill progress
      await this.db.updateBackfillProgress(
        mint,
        beforeSignature || "completed",
        totalProcessed
      );

      console.log(
        `✓ Backfill completed: ${totalProcessed} transactions processed`
      );
      return totalProcessed;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Backfill error for ${mint}:`, errorMessage);
      this.stats.errors++;
      throw error;
    }
  }

  async processBatch(transactions: any, mint: string | any[]) {
    let processed = 0;

    for (const tx of transactions) {
      try {
        const signature = tx.signature;
        const slot = tx.slot;
        const blockTime = tx.timestamp || tx.blockTime;

        if (!blockTime) continue;

        // Extract transfers
        const transfers = this.extractTransfers(
          tx,
          signature,
          slot,
          blockTime,
          mint
        );

        // Store each transfer
        for (const transfer of transfers) {
          const result = await this.db.insertTransfer(transfer);
          if (result.rows.length > 0) {
            processed++;
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`Error processing tx ${tx.signature}:`, errorMessage);
        this.stats.errors++;
      }
    }

    this.stats.totalProcessed += processed;
    return processed;
  }

  extractTransfers(
    tx: { tokenTransfers: any[] },
    signature: any,
    slot: any,
    blockTime: number,
    targetMint: string | any[]
  ) {
    const transfers: {
      signature: any;
      instructionIndex: number;
      slot: any;
      blockTime: Date;
      mint: any;
      from: any;
      to: any;
      amount: number;
      decimals: any;
    }[] = [];

    // Check if transaction has token transfers
    if (!tx.tokenTransfers || tx.tokenTransfers.length === 0) {
      return transfers;
    }

    // Process each token transfer
    tx.tokenTransfers.forEach((transfer, idx) => {
      // Only process transfers for the target mint
      if (transfer.mint === targetMint) {
        transfers.push({
          signature,
          instructionIndex: idx,
          slot,
          blockTime: new Date(blockTime * 1000),
          mint: transfer.mint,
          from: transfer.fromUserAccount || transfer.source,
          to: transfer.toUserAccount || transfer.destination,
          amount: parseFloat(transfer.tokenAmount || 0),
          decimals: transfer.decimals || 0,
        });
      }
    });

    return transfers;
  }

  async backfillAll(tokenMints: string | any[], daysBack = 30) {
    console.log(`\n📚 Starting backfill for ${tokenMints.length} token(s)`);

    const results = [];

    for (const mint of tokenMints) {
      try {
        const processed = await this.backfill(mint, daysBack);
        results.push({ mint, processed, success: true });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`Failed to backfill ${mint}:`, errorMessage);
        results.push({
          mint,
          processed: 0,
          success: false,
          error: errorMessage,
        });
      }
    }

    return results;
  }

  sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats() {
    return this.stats;
  }
}
