import sha256 from 'sha256';
import { v4 as uuidv4 } from 'uuid';
import { Level } from 'level';
import crypto from 'crypto';


const currentNodeUrl = process.argv[3];

class Blockchain {
  constructor() {
    this.chain = [];
    this.pendingTransactions = [];
    this.currentNodeUrl = currentNodeUrl;
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

    // Peer discovery configuration
    this.discoverySeeds = [
      'https://seed1.ekehi.network',
      'https://seed2.ekehi.network'
    ];
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
    
    
    
    this.initializeBlockchain();
  }

  async initializeBlockchain() {
    try {
      // Initialize database first
      await this.db.open();
      console.log('Database opened successfully');
      
      // Try to load existing data
      await this.loadFromDatabase();
      console.log(`${this.networkName} loaded with ${this.chain.length} blocks`);
    } catch (error) {
      console.log(`Creating new ${this.networkName}...`);
      this.createGenesisBlock();
      
      // Save after ensuring DB is open
      try {
        if (!this.db.status || this.db.status === 'opening') {
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

      // Add mining reward
      const rewardTransaction = this.createNewTransaction(
        this.miningReward,
        '00',
        this.minerAddress
      );
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
    const broadcastPromises = this.networkNodes.map(async (nodeUrl) => {
      try {
        // In a real implementation, you'd use HTTP requests here
        console.log(`Broadcasting block to ${nodeUrl}`);
      } catch (error) {
        console.error(`Failed to broadcast to ${nodeUrl}:`, error.message);
      }
    });

    await Promise.allSettled(broadcastPromises);
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
      // Ensure database is ready
      if (this.db.status !== 'open') {
        await this.db.open();
      }
      
      await this.db.put('blockchain', this.chain);
      await this.db.put('pendingTransactions', this.pendingTransactions);
      await this.db.put('networkNodes', this.networkNodes);
      await this.db.put('config', {
        difficulty: this.difficulty,
        minerAddress: this.minerAddress,
        lastSaved: Date.now()
      });
    } catch (error) {
      console.error('Error saving to database:', error);
      // Continue operation even if database save fails
    }
  }

  createGenesisBlock() {
    const genesisBlock = {
      index: 1,
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
    
    // Enforce minimum fee requirement - must be exactly what's provided, not defaulted
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
    return block.nonce === 100 &&
           block.previousBlockHash === '0' &&
           block.hash === '0' &&
           block.transactions.length === 0 &&
           block.index === 1;
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
    let longestChain = null;
    let maxLength = this.chain.length;
    let newPendingTransactions = null;

    for (const blockchain of blockchains) {
      if (blockchain.chain.length > maxLength && this.chainIsValid(blockchain.chain)) {
        maxLength = blockchain.chain.length;
        longestChain = blockchain.chain;
        newPendingTransactions = blockchain.pendingTransactions;
      }
    }

    if (longestChain) {
      this.chain = longestChain;
      this.pendingTransactions = newPendingTransactions || [];
      await this.saveToDatabase();
      return true;
    }
    return false;
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
      await this.saveToDatabase();
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

  // Peer discovery functionality
  async startPeerDiscovery() {
    console.log('Starting peer discovery...');
    this.discoveryInterval = setInterval(async () => {
      await this.discoverPeers();
    }, 30000); // Discover peers every 30 seconds
  }

  stopPeerDiscovery() {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
      console.log('Peer discovery stopped');
    }

  

  async discoverPeers() {
    try {
      // Simulate peer discovery (in real implementation, would contact seed nodes)
      console.log(`Peer discovery: ${this.networkNodes.length} peers connected`);
      
      // Update metrics
      this.nodeMetrics.peersConnected = this.networkNodes.length;
      
      return {
        discovered: 0,
        total: this.networkNodes.length
      };
    } catch (error) {
      console.error('Peer discovery error:', error);
      return { discovered: 0, total: this.networkNodes.length };
    }
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