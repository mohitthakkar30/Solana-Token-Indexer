import { Database } from './database.js';
import { RealtimeIndexer } from './realtime-indexer.js';
import { HistoricalBackfiller } from './backfiller.js';
import { config } from './config.js';

class TokenIndexer {
  constructor() {
    this.db = new Database();
    this.realtimeIndexer = null;
    this.backfiller = null;
    this.isRunning = false;
  }

  async start() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Solana Token Transfer Indexer        ║');
    console.log('║   Powered by Helius                    ║');
    console.log('╚════════════════════════════════════════╝\n');

    // Connect to database
    console.log('Connecting to database...');
    const connected = await this.db.connect();
    if (!connected) {
      console.error('Failed to connect to database. Please check your configuration.');
      process.exit(1);
    }

    // Show current stats
    await this.showStats();

    // Ask user what to do
    await this.promptUser();
  }

  async promptUser() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   Choose an option:                    ║');
    console.log('║   1. Start real-time indexing          ║');
    console.log('║   2. Run historical backfill           ║');
    console.log('║   3. Both (backfill + real-time)       ║');
    console.log('║   4. Show stats                        ║');
    console.log('║   5. Exit                              ║');
    console.log('╚════════════════════════════════════════╝\n');

    // For now, auto-run option 3 (both)
    // In production, you'd use readline to get user input
    console.log('Auto-starting: Backfill + Real-time indexing\n');
    await this.runBoth();
  }

  async runRealtime() {
    console.log('\n🔴 Starting real-time indexing only...\n');
    
    this.realtimeIndexer = new RealtimeIndexer(this.db, config.indexer.tokenMints);
    this.realtimeIndexer.start();
    
    this.isRunning = true;
    this.startStatsReporter();
  }

  async runBackfill() {
    console.log('\n📚 Running historical backfill...\n');
    
    this.backfiller = new HistoricalBackfiller(this.db);
    const results = await this.backfiller.backfillAll(
      config.indexer.tokenMints,
      config.indexer.backfillDays
    );
    
    console.log('\n✓ Backfill Results:');
    results.forEach(result => {
      const status = result.success ? '✓' : '✗';
      console.log(`  ${status} ${result.mint.slice(0, 8)}...: ${result.processed} transfers`);
    });
  }

  async runBoth() {
    // First run backfill
    await this.runBackfill();
    
    // Then start real-time
    await this.runRealtime();
  }

  async showStats() {
    const stats = await this.db.getStats();
    const count = await this.db.getTransferCount();
    const lastTime = await this.db.getLastTransferTime();
    
    console.log('\n📊 Current Database Stats:');
    console.log(`   Total transfers: ${count}`);
    
    if (lastTime) {
      const age = Math.floor((Date.now() - new Date(lastTime).getTime()) / 1000 / 60);
      console.log(`   Last transfer: ${age} minutes ago`);
      console.log(`   Unique mints: ${stats.unique_mints}`);
      console.log(`   Unique senders: ${stats.unique_senders}`);
      console.log(`   Unique receivers: ${stats.unique_receivers}`);
    } else {
      console.log('   No transfers indexed yet');
    }
  }

  startStatsReporter() {
    // Report stats every 60 seconds
    setInterval(async () => {
      if (this.realtimeIndexer) {
        const stats = this.realtimeIndexer.getStats();
        console.log(`\n📊 Real-time Stats:`);
        console.log(`   Messages: ${stats.messagesReceived}`);
        console.log(`   Transfers processed: ${stats.transfersProcessed}`);
        console.log(`   Errors: ${stats.errors}`);
      }
      
      await this.showStats();
    }, 60000);
  }

  async stop() {
    console.log('\n\nShutting down...');
    
    if (this.realtimeIndexer) {
      this.realtimeIndexer.stop();
    }
    
    await this.db.close();
    console.log('✓ Shutdown complete');
    process.exit(0);
  }
}

// Main execution
const indexer = new TokenIndexer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await indexer.stop();
});

process.on('SIGTERM', async () => {
  await indexer.stop();
});

// Start the indexer
indexer.start().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
