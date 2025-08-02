
//import crypto from 'crypto';

export class SyncManager {
  constructor(blockchain) {
    this.blockchain = blockchain;
    this.syncInProgress = false;
    this.lastSyncAttempt = 0;
    this.syncCooldown = 5000; // 5 seconds between sync attempts
    this.maxRetries = 3;
  }

  async performFullSync() {
    if (this.syncInProgress) {
      console.log('🔄 Sync already in progress, skipping...');
      return { success: false, reason: 'sync_in_progress' };
    }

    if (Date.now() - this.lastSyncAttempt < this.syncCooldown) {
      console.log('🔄 Sync cooldown active, skipping...');
      return { success: false, reason: 'cooldown_active' };
    }

    this.syncInProgress = true;
    this.lastSyncAttempt = Date.now();

    try {
      console.log('🚀 Starting comprehensive blockchain sync...');
      console.log(`📊 Local chain: ${this.blockchain.chain.length} blocks`);

      // Import request-promise
      let rp;
      try {
        rp = (await import('request-promise')).default;
      } catch (importError) {
        console.error('❌ Failed to import request-promise:', importError.message);
        return { success: false, reason: 'import_failed' };
      }

      if (this.blockchain.networkNodes.length === 0) {
        console.log('⚠️ No peers available for sync');
        return { success: false, reason: 'no_peers' };
      }

      // Step 1: Collect blockchain data from all peers
      const peerData = await this.collectPeerBlockchains(rp);

      if (peerData.length === 0) {
        console.log('❌ No valid blockchain data received from peers');
        return { success: false, reason: 'no_peer_data' };
      }

      // Step 2: Find the best blockchain
      const bestChain = this.selectBestBlockchain(peerData);

      if (!bestChain) {
        console.log('❌ No valid blockchain found from peers');
        return { success: false, reason: 'no_valid_chain' };
      }

      // Step 3: Compare and update if necessary
      const syncResult = await this.updateBlockchainIfBetter(bestChain);

      console.log(`📊 Sync completed - Updated: ${syncResult.updated}, Local blocks: ${this.blockchain.chain.length}`);

      return {
        success: true,
        updated: syncResult.updated,
        localBlocks: this.blockchain.chain.length,
        peerBlocks: bestChain.chain.length,
        bestPeer: bestChain.source
      };

    } catch (error) {
      console.error('💥 Sync failed:', error.message);
      return { success: false, reason: 'sync_error', error: error.message };
    } finally {
      this.syncInProgress = false;
    }
  }

  async collectPeerBlockchains(rp) {
    console.log(`🔍 Collecting blockchain data from ${this.blockchain.networkNodes.length} peers...`);
    const peerData = [];

    for (const peerUrl of this.blockchain.networkNodes) {
      try {
        console.log(`📡 Fetching blockchain from ${peerUrl}...`);

        const response = await rp({
          uri: peerUrl + "/blockchain",
          method: "GET",
          json: true,
          timeout: 15000
        });

        if (response && response.chain && Array.isArray(response.chain)) {
          const peerInfo = {
            source: peerUrl,
            chain: response.chain,
            pendingTransactions: response.pendingTransactions || [],
            difficulty: response.difficulty || 1,
            networkName: response.networkName || 'Unknown'
          };

          // Validate the blockchain structure
          if (this.validateBlockchainStructure(peerInfo.chain)) {
            peerData.push(peerInfo);
            console.log(`✅ Valid blockchain from ${peerUrl}: ${peerInfo.chain.length} blocks, difficulty ${peerInfo.difficulty}`);
          } else {
            console.log(`❌ Invalid blockchain structure from ${peerUrl}`);
          }
        } else {
          console.log(`❌ Invalid response format from ${peerUrl}`);
        }
      } catch (error) {
        console.log(`❌ Failed to fetch blockchain from ${peerUrl}: ${error.message}`);
      }
    }

    return peerData;
  }

  validateBlockchainStructure(chain) {
    if (!Array.isArray(chain) || chain.length === 0) {
      return false;
    }

    // Check genesis block
    const genesis = chain[0];
    if (!genesis || genesis.index !== 1 || genesis.previousBlockHash !== '0') {
      return false;
    }

    // Check chain integrity
    for (let i = 1; i < chain.length; i++) {
      const currentBlock = chain[i];
      const previousBlock = chain[i - 1];

      if (!currentBlock || !previousBlock) return false;
      if (currentBlock.index !== previousBlock.index + 1) return false;
      if (currentBlock.previousBlockHash !== previousBlock.hash) return false;
      if (!currentBlock.hash || !currentBlock.timestamp) return false;
    }

    return true;
  }

  selectBestBlockchain(peerData) {
    if (peerData.length === 0) return null;

    console.log('🏆 Selecting best blockchain from peers...');

    // Sort by length first, then by difficulty, then by total work
    const sortedPeers = peerData.sort((a, b) => {
      // Primary: chain length
      if (a.chain.length !== b.chain.length) {
        return b.chain.length - a.chain.length;
      }

      // Secondary: difficulty
      if (a.difficulty !== b.difficulty) {
        return b.difficulty - a.difficulty;
      }

      // Tertiary: total work (sum of difficulties)
      const aWork = this.calculateTotalWork(a.chain);
      const bWork = this.calculateTotalWork(b.chain);
      return bWork - aWork;
    });

    const bestChain = sortedPeers[0];
    console.log(`🥇 Best chain selected: ${bestChain.source} with ${bestChain.chain.length} blocks, difficulty ${bestChain.difficulty}`);

    return bestChain;
  }

  calculateTotalWork(chain) {
    return chain.reduce((total, block) => {
      const difficulty = block.difficulty || 1;
      return total + Math.pow(2, difficulty);
    }, 0);
  }

  async updateBlockchainIfBetter(bestChain) {
    const localLength = this.blockchain.chain.length;
    const remoteLength = bestChain.chain.length;

    console.log(`⚖️ Comparing chains: Local(${localLength}) vs Remote(${remoteLength})`);

    // Only update if remote chain is longer
    if (remoteLength <= localLength) {
      console.log(`✅ Local chain is current or better (${localLength} >= ${remoteLength})`);
      return { updated: false, reason: 'local_is_current' };
    }

    // Validate the remote chain thoroughly
    if (!this.blockchain.chainIsValid(bestChain.chain)) {
      console.log(`❌ Remote chain validation failed`);
      return { updated: false, reason: 'invalid_remote_chain' };
    }

    console.log(`🔄 Updating local blockchain from ${localLength} to ${remoteLength} blocks...`);

    try {
      // Backup current state
      const backupChain = [...this.blockchain.chain];
      const backupPending = [...this.blockchain.pendingTransactions];

      // Update blockchain
      this.blockchain.chain = [...bestChain.chain];

      // Update pending transactions (keep local ones that aren't in the new chain)
      this.blockchain.pendingTransactions = this.mergePendingTransactions(
        bestChain.pendingTransactions || [],
        backupPending
      );

      // Update difficulty if available
      if (bestChain.difficulty) {
        this.blockchain.difficulty = bestChain.difficulty;
      }

      // Save to database
      await this.blockchain.saveToDatabase();

      console.log(`✅ Blockchain updated successfully! New length: ${this.blockchain.chain.length}`);
      console.log(`📝 Pending transactions: ${this.blockchain.pendingTransactions.length}`);

      return { 
        updated: true, 
        oldLength: localLength, 
        newLength: this.blockchain.chain.length,
        source: bestChain.source
      };

    } catch (error) {
      console.error('❌ Failed to update blockchain:', error);
      return { updated: false, reason: 'update_failed', error: error.message };
    }
  }

  mergePendingTransactions(remotePending, localPending) {
    // Get all transaction IDs that are already in the blockchain
    const confirmedTxIds = new Set();
    this.blockchain.chain.forEach(block => {
      block.transactions.forEach(tx => {
        if (tx.transactionId) {
          confirmedTxIds.add(tx.transactionId);
        }
      });
    });

    // Merge remote and local pending transactions, excluding confirmed ones
    const allPending = [...(remotePending || []), ...(localPending || [])];
    const uniquePending = [];
    const seenTxIds = new Set();

    for (const tx of allPending) {
      if (tx.transactionId && 
          !confirmedTxIds.has(tx.transactionId) && 
          !seenTxIds.has(tx.transactionId)) {
        uniquePending.push(tx);
        seenTxIds.add(tx.transactionId);
      }
    }

    return uniquePending;
  }

  // Enhanced health check for peers
  async checkPeerHealth(peerUrl, rp) {
    try {
      const response = await rp({
        uri: peerUrl + "/stats",
        method: "GET",
        json: true,
        timeout: 5000
      });

      return {
        healthy: true,
        blocks: response.totalBlocks || 0,
        peers: response.networkNodes || 0,
        difficulty: response.difficulty || 1,
        uptime: response.uptime || 0
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }

  async cleanupUnhealthyPeers() {
    if (this.blockchain.networkNodes.length === 0) return;

    let rp;
    try {
      rp = (await import('request-promise')).default;
    } catch (importError) {
      return;
    }

    console.log('🧹 Cleaning up unhealthy peers...');
    const healthyPeers = [];
    const removedPeers = [];

    for (const peerUrl of this.blockchain.networkNodes) {
      const health = await this.checkPeerHealth(peerUrl, rp);

      if (health.healthy) {
        healthyPeers.push(peerUrl);
      } else {
        removedPeers.push(peerUrl);
        console.log(`🗑️ Removing unhealthy peer: ${peerUrl} (${health.error})`);
      }
    }

    if (removedPeers.length > 0) {
      this.blockchain.networkNodes = healthyPeers;
      await this.blockchain.saveToDatabase();
      console.log(`🧹 Cleanup complete: removed ${removedPeers.length} unhealthy peers`);
    }
  }
}
