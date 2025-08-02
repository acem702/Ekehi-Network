import sha256 from 'sha256';
import { v4 as uuidv4 } from 'uuid';
import { Level } from 'level';
import crypto from 'crypto';
import { ContractSystem } from './contracts.js';
import { SyncManager } from './sync-manager.js';


const currentNodeUrl = process.argv[3];

class Blockchain {
  constructor() {
    this.chain = [];
    this.pendingTransactions = [];
    this.networkNodes = [];
    this.difficulty = 4;
    this.miningReward = 12.5;
    this.maxTransactionsPerBlock = 10;
    this.targetBlockTime = 10000; // 10 seconds
    this.tokenName = 'Ekehi';
    this.tokenSymbol = 'EKH';
    this.networkName = 'Ekehi Network';
    this.minTransactionFee = 0.001;

    // Auto-mining configuration
    this.autoMining = true;
    this.miningInterval = null;
    this.isMining = false;
    this.minerAddress = this.generateWalletAddress();

    // Enhanced peer discovery configuration
    this.discoverySeeds = [
      // Add your actual Replit URLs here when you have multiple instances
      // Example: 'https://blockchain-node-2.your-username.repl.co',
      // Example: 'https://blockchain-node-3.your-username.repl.co'
      'https://96b1a29f-366b-473e-814e-fa9afb7a900d-00-uazzfrfplfy.riker.replit.dev'
    ];
    
    // Peer health monitoring
    this.peerHealthCache = new Map(); // url -> { lastSeen, blocks, healthy }
    this.maxUnhealthyPeers = 10; // Remove unhealthy peers after this many
    this.peerHealthCheckInterval = 30000; // Check peer health every 30 seconds
    
    // Fix currentNodeUrl to use proper Replit URL if available
    if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
      this.currentNodeUrl = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
    } else if (currentNodeUrl && !currentNodeUrl.includes('localhost')) {
      this.currentNodeUrl = currentNodeUrl;
    } else {
      this.currentNodeUrl = `http://0.0.0.0:${process.argv[2] || 5000}`;
    }
    this.maxPeers = 20;
    this.discoveryInterval = null;
    this.nodeStatus = 'active';
    this.nodeMetrics = {
      uptime: Date.now(),
      blocksProcessed: 0,
      transactionsProcessed: 0,
      peersConnected: 0,
      hashRate: 0
    };

    // Initialize LevelDB
    this.db = new Level('./blockchain-db', { valueEncoding: 'json' });
    
    // Initialize contract system
    this.contractSystem = new ContractSystem(this);
    
    // Initialize sync manager
    this.syncManager = new SyncManager(this);
    
    this.initializeBlockchain();
  }

  async initializeBlockchain() {
    try {
      // Ensure database is properly opened first
      if (this.db.status !== 'open') {
        await this.db.open();
      }
      console.log('Database opened successfully');
      
      // Try to load existing data
      await this.loadFromDatabase();
      console.log(`${this.networkName} loaded with ${this.chain.length} blocks`);
      
      // Verify we have a valid genesis block
      if (this.chain.length === 0 || !this.isValidGenesisBlock(this.chain[0])) {
        console.log('Invalid or missing genesis block, creating new one...');
        this.chain = []; // Clear any invalid blocks
        this.createGenesisBlock();
        await this.saveToDatabase();
        console.log('New genesis block created and saved');
      }
    } catch (error) {
      console.log(`Creating new ${this.networkName}...`);
      this.chain = []; // Ensure clean slate
      this.createGenesisBlock();
      
      // Save after ensuring DB is open
      try {
        if (this.db.status !== 'open') {
          await this.db.open();
        }
        await this.saveToDatabase();
        console.log('Genesis block created and saved');
      } catch (saveError) {
        console.error('Failed to save genesis block:', saveError);
        // Continue without persistent storage for now
      }
    }

    // Start auto-mining if enabled
    if (this.autoMining) {
      this.startAutoMining();
    }

    // Start peer discovery and metrics
    this.startPeerDiscovery();
    this.startMetricsCollection();
  }

  // Generate EKH wallet address
  generateWalletAddress() {
    const randomBytes = crypto.randomBytes(20);
    const hash = crypto.createHash('sha256').update(randomBytes).digest();
    const checksum = hash.slice(0, 4);
    const addressBytes = Buffer.concat([randomBytes, checksum]);
    const address = 'EKH' + addressBytes.toString('hex').toUpperCase();
    return address;
  }

  // Validate EKH address format
  isValidAddress(address) {
    if (!address || typeof address !== 'string') return false;
    if (address === '00') return true; // Mining reward address
    if (!address.startsWith('EKH')) return false;
    if (address.length !== 51) return false; // EKH + 48 hex characters

    try {
      const hexPart = address.slice(3);
      const addressBytes = Buffer.from(hexPart, 'hex');
      if (addressBytes.length !== 24) return false;

      const payload = addressBytes.slice(0, 20);
      const checksum = addressBytes.slice(20);
      const hash = crypto.createHash('sha256').update(payload).digest();
      const expectedChecksum = hash.slice(0, 4);

      return checksum.equals(expectedChecksum);
    } catch (error) {
      return false;
    }
  }

  // Auto-mining functionality
  startAutoMining() {
    console.log(`Starting auto-mining on ${this.networkName}...`);
    console.log(`Miner address: ${this.minerAddress}`);

    this.miningInterval = setInterval(async () => {
      if (!this.isMining && this.pendingTransactions.length > 0) {
        await this.autoMine();
      }
    }, 5000); // Check every 5 seconds
  }

  stopAutoMining() {
    if (this.miningInterval) {
      clearInterval(this.miningInterval);
      this.miningInterval = null;
      console.log('Auto-mining stopped');
    }
  }

  async autoMine() {
    if (this.isMining || this.pendingTransactions.length === 0) return;

    this.isMining = true;
    console.log(`Auto-mining started - ${this.pendingTransactions.length} pending transactions`);

    try {
      const lastBlock = this.getLastBlock();
      const previousBlockHash = lastBlock.hash;
      const currentBlockData = {
        transactions: this.pendingTransactions.slice(0, this.maxTransactionsPerBlock),
        index: lastBlock.index + 1,
      };

      const nonce = this.proofOfWork(previousBlockHash, currentBlockData);
      const blockHash = this.hashBlock(previousBlockHash, currentBlockData, nonce);

      // Add mining reward (mining rewards don't require fees)
      const rewardTransaction = {
        amount: this.miningReward,
        sender: '00',
        recipient: this.minerAddress,
        fee: 0,
        transactionId: uuidv4().split('-').join(''),
        timestamp: Date.now(),
        network: this.networkName
      };
      currentBlockData.transactions.push(rewardTransaction);

      const newBlock = await this.createNewBlock(nonce, previousBlockHash, blockHash);
      this.adjustDifficulty();

      console.log(`Block #${newBlock.index} mined successfully! Hash: ${blockHash.substring(0, 16)}...`);
      console.log(`Reward: ${this.miningReward} ${this.tokenSymbol} to ${this.minerAddress}`);

      // Broadcast to network nodes
      await this.broadcastNewBlock(newBlock);

    } catch (error) {
      console.error('Auto-mining error:', error);
    } finally {
      this.isMining = false;
    }
  }

  async broadcastNewBlock(newBlock) {
    if (this.networkNodes.length === 0) {
      console.log(`📢 No peers to broadcast to`);
      return;
    }

    console.log(`📢 Broadcasting new block to ${this.networkNodes.length} peers...`);
    
    // Import request-promise
    let rp;
    try {
      rp = (await import('request-promise')).default;
    } catch (importError) {
      console.error('❌ Failed to import request-promise for broadcast:', importError.message);
      return;
    }

    const broadcastPromises = this.networkNodes.map(async (nodeUrl) => {
      try {
        const requestOptions = {
          uri: nodeUrl + "/receive-new-block",
          method: "POST",
          body: { newBlock },
          json: true,
          timeout: 10000
        };

        const response = await rp(requestOptions);
        console.log(`✅ Block broadcast to ${nodeUrl}: ${response.note}`);
        return { success: true, nodeUrl, response };
      } catch (error) {
        console.error(`❌ Failed to broadcast to ${nodeUrl}:`, error.message);
        return { success: false, nodeUrl, error: error.message };
      }
    });

    const results = await Promise.allSettled(broadcastPromises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    console.log(`📊 Block broadcast completed: ${successful}/${this.networkNodes.length} successful`);
  }

  async loadFromDatabase() {
    try {
      const chainData = await this.db.get('blockchain');
      const pendingData = await this.db.get('pendingTransactions');
      const networkData = await this.db.get('networkNodes');
      const configData = await this.db.get('config');

      this.chain = chainData || [];
      this.pendingTransactions = pendingData || [];
      this.networkNodes = networkData || [];

      if (configData) {
        this.difficulty = configData.difficulty || this.difficulty;
        this.minerAddress = configData.minerAddress || this.minerAddress;
      }

      if (this.chain.length === 0) {
        throw new Error('No existing blockchain found');
      }
    } catch (error) {
      throw new Error('No existing blockchain found');
    }
  }

  async saveToDatabase() {
    try {
      // Check if database is available
      if (!this.db || this.db.status === 'closed') {
        console.log('Database not available, skipping save');
        return;
      }

      // Ensure database is ready
      if (this.db.status !== 'open') {
        try {
          await this.db.open();
        } catch (openError) {
          console.log('Could not open database, skipping save:', openError.message);
          return;
        }
      }
      
      // Save data with individual error handling
      try {
        await this.db.put('blockchain', this.chain);
        await this.db.put('pendingTransactions', this.pendingTransactions);
        await this.db.put('networkNodes', this.networkNodes);
        await this.db.put('config', {
          difficulty: this.difficulty,
          minerAddress: this.minerAddress,
          lastSaved: Date.now()
        });
        console.log('✅ Database saved successfully');
      } catch (writeError) {
        console.log('Database write failed, continuing without persistence:', writeError.message);
      }
    } catch (error) {
      console.log('Database save error:', error.message);
      // Continue operation even if database save fails
    }
  }

  createGenesisBlock() {
    // Only create if we don't already have a genesis block
    if (this.chain.length > 0) {
      console.log('Genesis block already exists, skipping creation');
      return;
    }
    
    const genesisBlock = {
      index: 1, // Always use index 1 for consistency
      timestamp: Date.now(),
      transactions: [],
      nonce: 100,
      hash: '0',
      previousBlockHash: '0',
      difficulty: this.difficulty,
      version: '1.0.0',
      network: this.networkName
    };
    this.chain.push(genesisBlock);
    console.log('Genesis block created with index 1');
  }

  async createNewBlock(nonce, previousBlockHash, hash) {
    const processedTransactions = this.pendingTransactions.slice(0, this.maxTransactionsPerBlock);

    // Calculate total fees
    const totalFees = processedTransactions.reduce((total, tx) => {
      return total + (tx.fee || 0);
    }, 0);

    const newBlock = {
      index: this.chain.length + 1,
      timestamp: Date.now(),
      transactions: processedTransactions,
      nonce,
      hash,
      previousBlockHash,
      difficulty: this.difficulty,
      totalFees,
      version: '1.0.0',
      network: this.networkName
    };

    this.pendingTransactions = this.pendingTransactions.slice(this.maxTransactionsPerBlock);
    this.chain.push(newBlock);

    await this.saveToDatabase();
    return newBlock;
  }

  getLastBlock() {
    return this.chain[this.chain.length - 1];
  }

  createNewTransaction(amount, sender, recipient, fee = 0) {
    // Enforce minimum fee - don't auto-adjust, validate as provided
    const actualFee = parseFloat(fee) || 0;
    
    // Enhanced validation
    if (!this.isValidTransaction(amount, sender, recipient, actualFee)) {
      throw new Error('Invalid transaction');
    }

    // Apply minimum fee after validation
    const finalFee = Math.max(actualFee, this.minTransactionFee);

    const newTransaction = {
      amount: parseFloat(amount),
      sender,
      recipient,
      fee: finalFee,
      transactionId: uuidv4().split('-').join(''),
      timestamp: Date.now(),
      network: this.networkName
    };
    return newTransaction;
  }

  isValidTransaction(amount, sender, recipient, fee = 0) {
    // Enhanced validation
    if (amount <= 0) return false;
    if (sender === recipient) return false;
    if (!sender || !recipient) return false;
    if (!this.isValidAddress(sender) && sender !== '00' && sender !== 'FAUCET' && sender !== 'ECOSYSTEM') return false;
    if (!this.isValidAddress(recipient)) return false;
    
    // Special senders don't require fees
    if (sender === '00' || sender === 'FAUCET' || sender === 'ECOSYSTEM') {
      return true;
    }
    
    // Enforce minimum fee requirement for regular transactions
    const actualFee = parseFloat(fee) || 0;
    if (actualFee < this.minTransactionFee) {
      throw new Error(`Minimum transaction fee is ${this.minTransactionFee} ${this.tokenSymbol}. Provided: ${actualFee}`);
    }

    // Check sender balance (except for mining rewards, faucet, and ecosystem)
    if (sender !== '00' && sender !== 'FAUCET' && sender !== 'ECOSYSTEM') {
      const senderData = this.getAddressData(sender);
      const totalAmount = parseFloat(amount) + actualFee;
      if (senderData.addressBalance < totalAmount) {
        throw new Error(`Insufficient balance. Required: ${totalAmount} ${this.tokenSymbol}, Available: ${senderData.addressBalance} ${this.tokenSymbol}`);
      }
    }
    return true;
  }

  hashBlock(previousBlockHash, currentBlockData, nonce) {
    const dataAsString = previousBlockHash + nonce.toString() + JSON.stringify(currentBlockData);
    const hash = sha256(dataAsString);
    return hash;
  }

  proofOfWork(previousBlockHash, currentBlockData) {
    let nonce = 0;
    let hash = this.hashBlock(previousBlockHash, currentBlockData, nonce);
    const target = '0'.repeat(this.difficulty);

    const startTime = Date.now();
    while (hash.substring(0, this.difficulty) !== target) {
      nonce++;
      hash = this.hashBlock(previousBlockHash, currentBlockData, nonce);
    }

    const miningTime = Date.now() - startTime;
    console.log(`Mining completed in ${miningTime}ms with nonce: ${nonce}`);
    return nonce;
  }

  async addTransactionToPendingTransactions(transactionObj) {
    // Add minimum fee if not specified
    if (!transactionObj.fee) {
      transactionObj.fee = this.minTransactionFee;
    }

    this.pendingTransactions.push(transactionObj);
    await this.saveToDatabase();
    return this.getLastBlock().index + 1;
  }

  // Enhanced chain validation
  chainIsValid(blockchain) {
    let validChain = true;

    const genesisBlock = blockchain[0];
    if (!this.isValidGenesisBlock(genesisBlock)) {
      return false;
    }

    for (let i = 1; i < blockchain.length; i++) {
      const currentBlock = blockchain[i];
      const prevBlock = blockchain[i - 1];

      if (!this.isValidBlockStructure(currentBlock)) {
        validChain = false;
        break;
      }

      if (currentBlock.previousBlockHash !== prevBlock.hash) {
        validChain = false;
        break;
      }

      const blockHash = this.hashBlock(prevBlock.hash, {
        transactions: currentBlock.transactions,
        index: currentBlock.index
      }, currentBlock.nonce);

      if (blockHash !== currentBlock.hash) {
        validChain = false;
        break;
      }

      const difficulty = currentBlock.difficulty || this.difficulty;
      if (blockHash.substring(0, difficulty) !== '0'.repeat(difficulty)) {
        validChain = false;
        break;
      }

      if (!this.validateBlockTransactions(currentBlock)) {
        validChain = false;
        break;
      }
    }

    return validChain;
  }

  isValidGenesisBlock(block) {
    return block &&
           block.nonce === 100 &&
           block.previousBlockHash === '0' &&
           block.hash === '0' &&
           Array.isArray(block.transactions) &&
           block.transactions.length === 0 &&
           (block.index === 1 || block.index === 0); // Allow either index 0 or 1
  }

  isValidBlockStructure(block) {
    return typeof block.index === 'number' &&
           typeof block.timestamp === 'number' &&
           Array.isArray(block.transactions) &&
           typeof block.nonce === 'number' &&
           typeof block.hash === 'string' &&
           typeof block.previousBlockHash === 'string';
  }

  validateBlockTransactions(block) {
    const transactionIds = new Set();
    let totalFees = 0;

    for (const tx of block.transactions) {
      if (transactionIds.has(tx.transactionId)) {
        return false;
      }
      transactionIds.add(tx.transactionId);

      // Validate transaction structure and addresses
      if (!this.isValidTransaction(tx.amount, tx.sender, tx.recipient, tx.fee)) {
        return false;
      }

      totalFees += tx.fee || 0;
    }

    // Validate total fees match block header
    if (block.totalFees !== undefined && block.totalFees !== totalFees) {
      return false;
    }

    return true;
  }

  async resolveConflicts(blockchains) {
    console.log(`🔄 Resolving conflicts with ${blockchains.length} blockchains...`);
    
    let bestChain = null;
    let maxLength = this.chain.length;
    let bestPendingTransactions = null;
    let maxWork = this.calculateChainWork(this.chain);

    console.log(`📊 Local chain: ${this.chain.length} blocks, work: ${maxWork}`);

    for (const blockchain of blockchains) {
      if (!blockchain || !blockchain.chain || !Array.isArray(blockchain.chain)) {
        console.log(`❌ Invalid blockchain structure`);
        continue;
      }

      const chainLength = blockchain.chain.length;
      const chainWork = this.calculateChainWork(blockchain.chain);
      
      console.log(`📊 Remote chain: ${chainLength} blocks, work: ${chainWork}`);

      // Only consider longer chains with valid structure
      if (chainLength > maxLength && this.chainIsValid(blockchain.chain)) {
        console.log(`✅ Found better chain: ${chainLength} blocks vs ${maxLength}`);
        maxLength = chainLength;
        maxWork = chainWork;
        bestChain = blockchain.chain;
        bestPendingTransactions = blockchain.pendingTransactions;
      } else {
        console.log(`❌ Chain rejected: length=${chainLength}, valid=${this.chainIsValid(blockchain.chain)}`);
      }
    }

    if (bestChain) {
      console.log(`🔄 Replacing chain: ${this.chain.length} -> ${bestChain.length} blocks`);
      
      // Create backup
      const oldChain = [...this.chain];
      const oldPending = [...this.pendingTransactions];
      
      try {
        this.chain = [...bestChain];
        this.pendingTransactions = bestPendingTransactions || [];
        await this.saveToDatabase();
        
        console.log(`✅ Chain replaced successfully!`);
        return true;
      } catch (error) {
        console.error(`❌ Failed to replace chain:`, error);
        // Restore backup
        this.chain = oldChain;
        this.pendingTransactions = oldPending;
        return false;
      }
    }
    
    console.log(`✅ Local chain is already the best`);
    return false;
  }

  calculateChainWork(chain) {
    return chain.reduce((total, block) => {
      const difficulty = block.difficulty || 1;
      return total + Math.pow(2, difficulty);
    }, 0);
  }

  getBlock(blockhash) {
    let correctBlock = null;
    this.chain.forEach(block => {
      if (block.hash === blockhash) correctBlock = block;
    });
    return correctBlock;
  }

  getTransaction(transactionId) {
    let correctTransaction = null;
    let correctBlock = null;
    this.chain.forEach(block => {
      block.transactions.forEach(transaction => {
        if (transaction.transactionId === transactionId) {
          correctTransaction = transaction;
          correctBlock = block;
        }
      });
    });
    return { transaction: correctTransaction, block: correctBlock };
  }

  getAddressData(address) {
    const addressTransactions = [];
    this.chain.forEach(block => {
      block.transactions.forEach(transaction => {
        if (transaction.sender === address || transaction.recipient === address) {
          addressTransactions.push(transaction);
        }
      });
    });

    let balance = 0;
    let totalSent = 0;
    let totalReceived = 0;
    let totalFees = 0;

    addressTransactions.forEach(transaction => {
      if (transaction.recipient === address) {
        balance += transaction.amount;
        totalReceived += transaction.amount;
      } else if (transaction.sender === address) {
        balance -= transaction.amount;
        balance -= (transaction.fee || 0);
        totalSent += transaction.amount;
        totalFees += (transaction.fee || 0);
      }
    });

    return {
      addressTransactions,
      addressBalance: balance,
      totalSent,
      totalReceived,
      totalFees,
      transactionCount: addressTransactions.length
    };
  }

  async addNetworkNode(nodeUrl) {
    if (this.networkNodes.indexOf(nodeUrl) === -1 && nodeUrl !== this.currentNodeUrl) {
      this.networkNodes.push(nodeUrl);
      // Non-blocking save
      this.saveToDatabase().catch(err => {
        console.log('Failed to save network node, continuing:', err.message);
      });
    }
  }

  async removeNetworkNode(nodeUrl) {
    const index = this.networkNodes.indexOf(nodeUrl);
    if (index > -1) {
      this.networkNodes.splice(index, 1);
      await this.saveToDatabase();
    }
  }

  getStats() {
    // Calculate total supply from mining rewards only
    const miningRewards = this.chain.reduce((total, block) => {
      return total + block.transactions.reduce((blockTotal, tx) => {
        return tx.sender === '00' ? blockTotal + tx.amount : blockTotal;
      }, 0);
    }, 0);

    // Calculate faucet distribution
    const faucetDistribution = this.chain.reduce((total, block) => {
      return total + block.transactions.reduce((blockTotal, tx) => {
        return tx.sender === 'FAUCET' ? blockTotal + tx.amount : blockTotal;
      }, 0);
    }, 0);

    // Calculate ecosystem rewards
    const ecosystemDistribution = this.chain.reduce((total, block) => {
      return total + block.transactions.reduce((blockTotal, tx) => {
        return tx.sender === 'ECOSYSTEM' ? blockTotal + tx.amount : blockTotal;
      }, 0);
    }, 0);

    // Total supply = mining rewards + faucet distribution + ecosystem rewards
    const totalSupply = miningRewards + faucetDistribution + ecosystemDistribution;
    
    // Calculate circulating supply (excludes locked/inactive addresses)
    const circulatingSupply = this.calculateCirculatingSupply();

    const totalTransactions = this.chain.reduce((total, block) => total + block.transactions.length, 0);

    return {
      networkName: this.networkName,
      tokenName: this.tokenName,
      tokenSymbol: this.tokenSymbol,
      totalBlocks: this.chain.length,
      pendingTransactions: this.pendingTransactions.length,
      difficulty: this.difficulty,
      networkNodes: this.networkNodes.length,
      totalTransactions,
      totalSupply,
      circulatingSupply,
      miningRewards,
      faucetDistribution,
      miningReward: this.miningReward,
      autoMining: this.autoMining,
      isMining: this.isMining,
      minerAddress: this.minerAddress,
      averageBlockTime: this.getAverageBlockTime(),
      inflationRate: this.calculateInflationRate(totalSupply)
    };
  }

  calculateCirculatingSupply() {
    // Get all unique addresses and their balances
    const addressBalances = new Map();
    
    this.chain.forEach(block => {
      block.transactions.forEach(tx => {
        // Add to recipient
        if (tx.recipient !== '00') {
          const currentBalance = addressBalances.get(tx.recipient) || 0;
          addressBalances.set(tx.recipient, currentBalance + tx.amount);
        }
        
        // Subtract from sender (except mining and faucet)
        if (tx.sender !== '00' && tx.sender !== 'FAUCET') {
          const currentBalance = addressBalances.get(tx.sender) || 0;
          addressBalances.set(tx.sender, currentBalance - tx.amount - (tx.fee || 0));
        }
      });
    });

    // Calculate circulating supply (addresses with recent activity)
    let circulatingSupply = 0;
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    for (const [address, balance] of addressBalances) {
      if (balance > 0) {
        // Check if address has been active in last 30 days
        const isActive = this.isAddressActiveRecently(address, thirtyDaysAgo);
        if (isActive || balance < 1000) { // Include all small holders and active addresses
          circulatingSupply += balance;
        }
      }
    }

    return circulatingSupply;
  }

  isAddressActiveRecently(address, since) {
    // Check if address has transactions since given timestamp
    for (let i = this.chain.length - 1; i >= 0; i--) {
      const block = this.chain[i];
      if (block.timestamp < since) break;
      
      for (const tx of block.transactions) {
        if (tx.sender === address || tx.recipient === address) {
          return true;
        }
      }
    }
    return false;
  }

  calculateInflationRate(totalSupply) {
    if (totalSupply === 0) return 0;
    
    // Calculate annual inflation based on current mining rate
    const avgBlockTime = this.getAverageBlockTime() || this.targetBlockTime;
    const blocksPerYear = (365 * 24 * 60 * 60 * 1000) / avgBlockTime;
    const annualMiningRewards = blocksPerYear * this.miningReward;
    
    return (annualMiningRewards / totalSupply) * 100;
  }

  getAverageBlockTime() {
    if (this.chain.length < 2) return 0;

    const recentBlocks = this.chain.slice(-10); // Last 10 blocks
    let totalTime = 0;

    for (let i = 1; i < recentBlocks.length; i++) {
      totalTime += recentBlocks[i].timestamp - recentBlocks[i-1].timestamp;
    }

    return Math.round(totalTime / (recentBlocks.length - 1));
  }

  adjustDifficulty() {
    if (this.chain.length < 2) return;

    const lastBlock = this.getLastBlock();
    const secondLastBlock = this.chain[this.chain.length - 2];
    const timeDiff = lastBlock.timestamp - secondLastBlock.timestamp;

    if (timeDiff < this.targetBlockTime / 2) {
      this.difficulty++;
      console.log(`Difficulty increased to ${this.difficulty}`);
    } else if (timeDiff > this.targetBlockTime * 2) {
      this.difficulty = Math.max(1, this.difficulty - 1);
      console.log(`Difficulty decreased to ${this.difficulty}`);
    }
  }

  // Utility methods for wallet functionality
  createWallet() {
    const privateKey = crypto.randomBytes(32).toString('hex');
    const address = this.generateWalletAddressFromPrivateKey(privateKey);
    return {
      address,
      privateKey,
      balance: 0,
      network: this.networkName,
      created: Date.now()
    };
  }

  generateWalletAddressFromPrivateKey(privateKey) {
    const keyHash = crypto.createHash('sha256').update(privateKey, 'hex').digest();
    const publicKey = keyHash.slice(0, 20);
    const checksum = crypto.createHash('sha256').update(publicKey).digest().slice(0, 4);
    const addressBytes = Buffer.concat([publicKey, checksum]);
    return 'EKH' + addressBytes.toString('hex').toUpperCase();
  }

  recoverWalletFromPrivateKey(privateKey) {
    try {
      if (!privateKey || privateKey.length !== 64) {
        throw new Error('Invalid private key format');
      }
      const address = this.generateWalletAddressFromPrivateKey(privateKey);
      const addressData = this.getAddressData(address);
      return {
        address,
        privateKey,
        balance: addressData.addressBalance,
        network: this.networkName,
        recovered: Date.now()
      };
    } catch (error) {
      throw new Error('Failed to recover wallet: ' + error.message);
    }
  }

  getNetworkInfo() {
    return {
      name: this.networkName,
      token: {
        name: this.tokenName,
        symbol: this.tokenSymbol
      },
      version: '1.0.0',
      difficulty: this.difficulty,
      blockTime: this.targetBlockTime,
      miningReward: this.miningReward
    };
  }

  // Node metrics for dashboard
  getNodeMetrics() {
    const currentTime = Date.now();
    const uptime = currentTime - this.nodeMetrics.uptime;
    
    // Calculate hash rate based on recent mining activity
    let hashRate = 0;
    if (this.chain.length > 1) {
      const recentBlocks = this.chain.slice(-5);
      let totalNonces = 0;
      let totalTime = 0;
      
      for (let i = 1; i < recentBlocks.length; i++) {
        totalNonces += recentBlocks[i].nonce;
        totalTime += recentBlocks[i].timestamp - recentBlocks[i-1].timestamp;
      }
      
      if (totalTime > 0) {
        hashRate = (totalNonces / (totalTime / 1000)); // Hashes per second
      }
    }

    return {
      uptime,
      blocksProcessed: this.chain.length - 1, // Exclude genesis
      transactionsProcessed: this.chain.reduce((total, block) => total + block.transactions.length, 0),
      peersConnected: this.networkNodes.length,
      hashRate,
      memoryUsage: process.memoryUsage(),
      nodeStatus: this.nodeStatus,
      lastBlockTime: this.chain.length > 0 ? this.getLastBlock().timestamp : null
    };
  }

  // Enhanced peer discovery functionality
  async startPeerDiscovery() {
    console.log('🚀 Starting enhanced peer discovery system...');
    
    // Initial discovery (slightly delayed to allow server startup)
    setTimeout(async () => {
      console.log('🔄 Running initial peer discovery...');
      await this.discoverPeers();
    }, 8000); // Initial discovery after 8 seconds
    
    // Regular discovery with exponential backoff on failures
    let failureCount = 0;
    const baseInterval = 45000; // Base 45 seconds
    
    const scheduleNextDiscovery = () => {
      const delay = Math.min(baseInterval * Math.pow(1.5, failureCount), 300000); // Max 5 minutes
      
      this.discoveryInterval = setTimeout(async () => {
        try {
          console.log(`🔄 Running scheduled peer discovery (attempt ${failureCount + 1})...`);
          const result = await this.discoverPeers();
          
          if (result.discovered > 0 || result.total > 0) {
            failureCount = 0; // Reset on success
            console.log(`✅ Discovery successful, resetting failure count`);
          } else {
            failureCount++;
            console.log(`⚠️ No peers found, failure count: ${failureCount}`);
          }
        } catch (error) {
          failureCount++;
          console.error(`❌ Discovery failed (${failureCount}):`, error.message);
        } finally {
          scheduleNextDiscovery(); // Schedule next discovery
        }
      }, delay);
      
      console.log(`⏰ Next peer discovery in ${Math.round(delay/1000)} seconds`);
    };
    
    scheduleNextDiscovery();
    
    // Start peer health monitoring
    this.startPeerHealthMonitoring();
  }

  // Start monitoring peer health
  startPeerHealthMonitoring() {
    console.log('💓 Starting peer health monitoring...');
    
    this.healthMonitorInterval = setInterval(async () => {
      if (this.networkNodes.length === 0) return;
      
      try {
        let rp;
        try {
          rp = (await import('request-promise')).default;
        } catch (importError) {
          return;
        }

        await this.cleanupUnhealthyPeers(rp);
        
        // Update peer health cache
        for (const peerUrl of this.networkNodes) {
          if (await this.quickHealthCheck(peerUrl, rp)) {
            this.peerHealthCache.set(peerUrl, {
              lastSeen: Date.now(),
              healthy: true
            });
          } else {
            const current = this.peerHealthCache.get(peerUrl) || {};
            this.peerHealthCache.set(peerUrl, {
              ...current,
              healthy: false
            });
          }
        }
        
        console.log(`💓 Health check complete: ${this.networkNodes.length} peers monitored`);
      } catch (error) {
        console.error('❌ Peer health monitoring error:', error.message);
      }
    }, this.peerHealthCheckInterval);
  }

  stopPeerDiscovery() {
    if (this.discoveryInterval) {
      clearTimeout(this.discoveryInterval);
      this.discoveryInterval = null;
      console.log('🛑 Peer discovery stopped');
    }
    
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = null;
      console.log('🛑 Peer health monitoring stopped');
    }
  }

  // Contract system delegate methods
  deployContract(code, creator, initialData = {}) {
    return this.contractSystem.deployContract(code, creator, initialData);
  }

  executeContract(contractId, method, params, caller, value = 0) {
    return this.contractSystem.executeContract(contractId, method, params, caller, value);
  }

  getContract(contractId) {
    return this.contractSystem.getContract(contractId);
  }

  getAllContracts() {
    return this.contractSystem.getAllContracts();
  }

  getContractEvents(contractId, eventName = null) {
    return this.contractSystem.getContractEvents(contractId, eventName);
  }

  getContractTemplates() {
    return this.contractSystem.getTemplates();
  }

  async discoverPeers() {
    try {
      console.log(`🔍 Starting enhanced peer discovery from ${this.discoverySeeds.length} seed nodes...`);
      console.log(`📍 Current node URL: ${this.currentNodeUrl}`);
      console.log(`📋 Discovery seeds:`, this.discoverySeeds);
      
      let discovered = 0;
      const healthySeeds = [];
      const failedSeeds = [];

      // Import request-promise
      let rp;
      try {
        rp = (await import('request-promise')).default;
      } catch (importError) {
        console.error('❌ Failed to import request-promise:', importError.message);
        return { discovered: 0, total: this.networkNodes.length };
      }

      // Phase 1: Health check all discovery seeds
      console.log(`🏥 Phase 1: Health checking ${this.discoverySeeds.length} seeds...`);
      
      for (const seedUrl of this.discoverySeeds) {
        if (seedUrl === this.currentNodeUrl) {
          console.log(`⏭️ Skipping self: ${seedUrl}`);
          continue;
        }
        
        try {
          const healthCheck = await rp({
            uri: seedUrl + "/stats",
            method: "GET",
            json: true,
            timeout: 8000,
            resolveWithFullResponse: false
          });

          if (healthCheck && healthCheck.totalBlocks >= 0) {
            healthySeeds.push({
              url: seedUrl,
              blocks: healthCheck.totalBlocks,
              peers: healthCheck.networkNodes || 0,
              uptime: Date.now()
            });
            console.log(`✅ Seed healthy: ${seedUrl} (${healthCheck.totalBlocks} blocks, ${healthCheck.networkNodes} peers)`);
          }
        } catch (error) {
          failedSeeds.push({ url: seedUrl, error: error.message });
          console.log(`❌ Seed unhealthy: ${seedUrl} - ${error.message}`);
        }
      }

      console.log(`📊 Health check complete: ${healthySeeds.length} healthy, ${failedSeeds.length} failed`);

      // Phase 2: Connect to healthy seeds in order of block count (highest first)
      healthySeeds.sort((a, b) => b.blocks - a.blocks);
      
      console.log(`🔗 Phase 2: Connecting to ${healthySeeds.length} healthy seeds...`);
      
      for (const seed of healthySeeds) {
        try {
          // Register with seed
          const registerResponse = await rp({
            uri: seed.url + "/register-and-broadcast-node",
            method: "POST",
            body: { newNodeUrl: this.currentNodeUrl },
            json: true,
            timeout: 12000
          });

          console.log(`📤 Registered with ${seed.url}:`, registerResponse.note);
          
          // Add to network if not present
          if (this.networkNodes.indexOf(seed.url) === -1) {
            this.networkNodes.push(seed.url);
            discovered++;
            console.log(`✅ Added seed to network: ${seed.url}`);
          }

          // Get peer list from seed
          try {
            const peersResponse = await rp({
              uri: seed.url + "/api/network/peers",
              method: "GET",
              json: true,
              timeout: 8000
            });
            
            if (peersResponse && peersResponse.peers) {
              console.log(`📋 Fetched ${peersResponse.peers.length} peers from ${seed.url}`);
              
              for (const peer of peersResponse.peers) {
                const peerUrl = peer.url || peer;
                if (this.isValidPeerUrl(peerUrl) && this.networkNodes.indexOf(peerUrl) === -1) {
                  // Quick health check for new peers
                  if (await this.quickHealthCheck(peerUrl, rp)) {
                    this.networkNodes.push(peerUrl);
                    discovered++;
                    console.log(`📡 Added healthy peer: ${peerUrl}`);
                  }
                }
              }
            }
          } catch (peersError) {
            console.log(`⚠️ Could not fetch peers from ${seed.url}:`, peersError.message);
          }

        } catch (seedError) {
          console.log(`❌ Failed to connect to seed ${seed.url}:`, seedError.message);
        }
      }

      // Phase 3: Clean up unhealthy peers
      await this.cleanupUnhealthyPeers(rp);

      // Phase 4: Enhanced sync with best peers
      if (this.networkNodes.length > 0) {
        console.log(`🔄 Phase 4: Enhanced sync with ${this.networkNodes.length} peers...`);
        const syncResult = await this.syncManager.performFullSync();
        if (syncResult.success && syncResult.updated) {
          console.log(`✅ Blockchain updated during discovery: ${syncResult.peerBlocks} blocks from ${syncResult.bestPeer}`);
        }
      }

      // Save updated network state (non-blocking)
      this.saveToDatabase().catch(err => {
        console.log('Peer discovery save failed, continuing:', err.message);
      });
      
      // Update metrics
      this.nodeMetrics.peersConnected = this.networkNodes.length;
      this.nodeMetrics.lastPeerDiscovery = Date.now();
      
      console.log(`🎉 Enhanced peer discovery completed:`);
      console.log(`   📡 ${discovered} new peers discovered`);
      console.log(`   🌐 ${this.networkNodes.length} total peers`);
      console.log(`   ✅ ${healthySeeds.length} healthy seeds`);
      console.log(`   ❌ ${failedSeeds.length} failed seeds`);
      
      return {
        discovered,
        total: this.networkNodes.length,
        peers: this.networkNodes,
        healthySeeds: healthySeeds.length,
        failedSeeds: failedSeeds.length
      };
    } catch (error) {
      console.error('💥 Enhanced peer discovery error:', error);
      return { discovered: 0, total: this.networkNodes.length, peers: this.networkNodes };
    }
  }

  // Validate peer URL format
  isValidPeerUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url === this.currentNodeUrl) return false;
    if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
    return url.startsWith('http://') || url.startsWith('https://');
  }

  // Quick health check for new peers
  async quickHealthCheck(peerUrl, rp) {
    try {
      const health = await rp({
        uri: peerUrl + "/stats",
        method: "GET",
        json: true,
        timeout: 5000
      });
      return health && typeof health.totalBlocks === 'number';
    } catch (error) {
      return false;
    }
  }

  // Clean up peers that are no longer responding
  async cleanupUnhealthyPeers(rp) {
    // First remove any localhost URLs that shouldn't be there
    const initialLength = this.networkNodes.length;
    this.networkNodes = this.networkNodes.filter(nodeUrl => {
      const isLocalhost = nodeUrl.includes('localhost') || nodeUrl.includes('127.0.0.1');
      if (isLocalhost) {
        console.log(`🗑️ Removing localhost peer: ${nodeUrl}`);
      }
      return !isLocalhost;
    });
    
    if (this.networkNodes.length !== initialLength) {
      console.log(`🧹 Removed ${initialLength - this.networkNodes.length} localhost peers`);
      await this.saveToDatabase();
    }
    
    await this.syncManager.cleanupUnhealthyPeers();
  }

  // New enhanced sync using SyncManager
  async intelligentSync(rp) {
    return await this.syncManager.performFullSync();
  }

  async syncWithPeers() {
    return await this.syncManager.performFullSync();
  }

  // Start all background processes
  startMetricsCollection() {
    setInterval(() => {
      this.nodeMetrics.uptime = Date.now() - this.nodeMetrics.uptime;
    }, 60000); // Update every minute
  }

  // Stop all processes
  stopAllProcesses() {
    this.stopAutoMining();
    this.stopPeerDiscovery();
    console.log('All node processes stopped');
  }
}

export default Blockchain;