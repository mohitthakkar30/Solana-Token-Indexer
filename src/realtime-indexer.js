import WebSocket from 'ws';
import { config } from './config.js';

export class RealtimeIndexer {
  constructor(database, tokenMints) {
    this.db = database;
    this.tokenMints = tokenMints;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.isConnected = false;
    this.pingInterval = null;
    
    // Stats
    this.stats = {
      messagesReceived: 0,
      transfersProcessed: 0,
      errors: 0
    };
  }

  start() {
    console.log('\n🚀 Starting real-time indexer...');
    console.log(`Monitoring ${this.tokenMints.length} token(s)`);
    this.connect();
  }

  connect() {
    const wsUrl = `${config.helius.wsUrl}/?api-key=${config.helius.apiKey}`;
    console.log('Connecting to WebSocket:', wsUrl.replace(config.helius.apiKey, 'xxx'));
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('✓ WebSocket connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.subscribe();
      this.startPing();
    });

    this.ws.on('message', async (data) => {
      try {
        this.stats.messagesReceived++;
        const message = JSON.parse(data.toString());
        console.log("Message ===> ", message);
        
        if (message.method === 'transactionNotification') {
          await this.processTransaction(message.params.result);
        }
      } catch (error) {
        console.error('Error processing message:', error.message);
        this.stats.errors++;
      }
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('WebSocket disconnected');
      this.isConnected = false;
      this.stopPing();
      this.reconnect();
    });
  }

  subscribe() {
    console.log("this.tokenMints => ", this.tokenMints);
    
    const request = {
        jsonrpc: "2.0",
        id: 420,
        method: "transactionSubscribe",
        params: [
            {
                accountInclude: ["7kHAVsiJ2itp2oy9PENZdCjFnonMgdprdDSUVSknB3gg"]
            },
            {
                commitment: "processed",
                encoding: "jsonParsed",
                transactionDetails: "full",
                showRewards: true,
                maxSupportedTransactionVersion: 0
            }
        ]
    };


    this.ws.send(JSON.stringify(request));
    console.log('✓ Subscribed to token transfers');
  }

  async processTransaction(result) {
    const signature = result.signature;
    const slot = result.slot;
    const meta = result.transaction.meta;
    
    if (!meta || meta.err) {
      return; // Skip failed transactions
    }

    const blockTime = result.blockTime || Math.floor(Date.now() / 1000);
    
    // Extract transfers from balance changes
    const transfers = this.extractTransfers(meta, signature, slot, blockTime);
    
    // Store transfers
    for (const transfer of transfers) {
      try {
        const result = await this.db.insertTransfer(transfer);
        if (result.rows.length > 0) {
          this.stats.transfersProcessed++;
          console.log(`✓ Indexed transfer: ${signature.slice(0, 8)}... (${transfer.mint.slice(0, 8)}...)`);
        }
      } catch (error) {
        console.error(`Error storing transfer ${signature}:`, error.message);
      }
    }
  }

  extractTransfers(meta, signature, slot, blockTime) {
    const transfers = [];
    const preBalances = meta.preTokenBalances || [];
    const postBalances = meta.postTokenBalances || [];
    
    // Build balance change map
    const changes = new Map();
    
    preBalances.forEach(pre => {
      const key = `${pre.accountIndex}-${pre.mint}`;
      changes.set(key, {
        mint: pre.mint,
        owner: pre.owner,
        preBal: parseFloat(pre.uiTokenAmount?.uiAmount || 0),
        postBal: 0,
        decimals: pre.uiTokenAmount?.decimals || 0
      });
    });
    
    postBalances.forEach(post => {
      const key = `${post.accountIndex}-${post.mint}`;
      if (changes.has(key)) {
        changes.get(key).postBal = parseFloat(post.uiTokenAmount?.uiAmount || 0);
      } else {
        changes.set(key, {
          mint: post.mint,
          owner: post.owner,
          preBal: 0,
          postBal: parseFloat(post.uiTokenAmount?.uiAmount || 0),
          decimals: post.uiTokenAmount?.decimals || 0
        });
      }
    });
    
    // Identify senders and receivers
    const senders = [];
    const receivers = [];
    
    changes.forEach(change => {
      const diff = change.postBal - change.preBal;
      
      if (diff < -0.000001) { // Sender (balance decreased)
        senders.push({
          mint: change.mint,
          owner: change.owner,
          amount: Math.abs(diff),
          decimals: change.decimals
        });
      } else if (diff > 0.000001) { // Receiver (balance increased)
        receivers.push({
          mint: change.mint,
          owner: change.owner,
          amount: diff,
          decimals: change.decimals
        });
      }
    });
    
    // Match senders to receivers
    let instructionIndex = 0;
    senders.forEach(sender => {
      const receiver = receivers.find(r => 
        r.mint === sender.mint && 
        Math.abs(r.amount - sender.amount) < 0.000001
      );
      
      if (receiver) {
        transfers.push({
          signature,
          instructionIndex: instructionIndex++,
          slot,
          blockTime: new Date(blockTime * 1000),
          mint: sender.mint,
          from: sender.owner,
          to: receiver.owner,
          amount: sender.amount * Math.pow(10, sender.decimals), // Convert to raw amount
          decimals: sender.decimals
        });
      }
    });
    
    return transfers;
  }

  startPing() {
    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('✗ Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  getStats() {
    return this.stats;
  }

  stop() {
    console.log('\nStopping real-time indexer...');
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
