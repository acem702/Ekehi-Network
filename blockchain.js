
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
    this.difficulty = 4; // Adjustable difficulty
    this.miningReward = 12.5;
    this.maxTransactionsPerBlock = 10;
    
    // Initialize LevelDB
    this.db = new Level('./blockchain-db', { valueEncoding: 'json' });
    this.initializeBlockchain();
  }

  async initializeBlockchain() {
    try {
      // Try to load existing blockchain from database
      await this.loadFromDatabase();
    } catch (error) {
      // If no existing blockchain, create genesis block
      console.log('Creating new blockchain...');
      this.createGenesisBlock();
      await this.saveToDatabase();
    }
  }

  async loadFromDatabase() {
    try {
      const chainData = await this.db.get('blockchain');
      const pendingData = await this.db.get('pendingTransactions');
      const networkData = await this.db.get('networkNodes');
      
      this.chain = chainData || [];
      this.pendingTransactions = pendingData || [];
      this.networkNodes = networkData || [];
      
      console.log(`Loaded blockchain with ${this.chain.length} blocks`);
    } catch (error) {
      throw new Error('No existing blockchain found');
    }
  }

  async saveToDatabase() {
    try {
      await this.db.put('blockchain', this.chain);
      await this.db.put('pendingTransactions', this.pendingTransactions);
      await this.db.put('networkNodes', this.networkNodes);
    } catch (error) {
      console.error('Error saving to database:', error);
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
      difficulty: this.difficulty
    };
    this.chain.push(genesisBlock);
  }

  async createNewBlock(nonce, previousBlockHash, hash) {
    const newBlock = {
      index: this.chain.length + 1,
      timestamp: Date.now(),
      transactions: this.pendingTransactions.slice(0, this.maxTransactionsPerBlock),
      nonce,
      hash,
      previousBlockHash,
      difficulty: this.difficulty
    };

    // Remove processed transactions from pending pool
    this.pendingTransactions = this.pendingTransactions.slice(this.maxTransactionsPerBlock);
    this.chain.push(newBlock);
    
    // Save to database
    await this.saveToDatabase();
    return newBlock;
  }

  getLastBlock() {
    return this.chain[this.chain.length - 1];
  }

  createNewTransaction(amount, sender, recipient) {
    // Validate transaction
    if (!this.isValidTransaction(amount, sender, recipient)) {
      throw new Error('Invalid transaction');
    }

    const newTransaction = {
      amount: parseFloat(amount),
      sender,
      recipient,
      transactionId: uuidv4().split('-').join(''),
      timestamp: Date.now()
    };
    return newTransaction;
  }

  isValidTransaction(amount, sender, recipient) {
    // Basic validation
    if (amount <= 0) return false;
    if (sender === recipient) return false;
    if (!sender || !recipient) return false;
    
    // Check sender balance (except for mining rewards)
    if (sender !== "00") {
      const senderData = this.getAddressData(sender);
      if (senderData.addressBalance < amount) {
        return false;
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
    
    while (hash.substring(0, this.difficulty) !== target) {
      nonce++;
      hash = this.hashBlock(previousBlockHash, currentBlockData, nonce);
    }
    return nonce;
  }

  async addTransactionToPendingTransactions(transactionObj) {
    this.pendingTransactions.push(transactionObj);
    await this.saveToDatabase();
    return this.getLastBlock()['index'] + 1;
  }

  // Enhanced chain validation with more checks
  chainIsValid(blockchain) {
    let validChain = true;

    // Validate genesis block
    const genesisBlock = blockchain[0];
    if (!this.isValidGenesisBlock(genesisBlock)) {
      return false;
    }

    // Validate each block in the chain
    for (let i = 1; i < blockchain.length; i++) {
      const currentBlock = blockchain[i];
      const prevBlock = blockchain[i - 1];
      
      // Check if block structure is valid
      if (!this.isValidBlockStructure(currentBlock)) {
        validChain = false;
        break;
      }

      // Verify hash chain
      if (currentBlock['previousBlockHash'] !== prevBlock['hash']) {
        validChain = false;
        break;
      }

      // Verify block hash
      const blockHash = this.hashBlock(prevBlock['hash'], {
        transactions: currentBlock['transactions'],
        index: currentBlock['index']
      }, currentBlock['nonce']);

      if (blockHash !== currentBlock['hash']) {
        validChain = false;
        break;
      }

      // Check proof of work
      const difficulty = currentBlock.difficulty || this.difficulty;
      if (blockHash.substring(0, difficulty) !== '0'.repeat(difficulty)) {
        validChain = false;
        break;
      }

      // Validate transactions in block
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
    // Check for duplicate transactions
    const transactionIds = new Set();
    for (const tx of block.transactions) {
      if (transactionIds.has(tx.transactionId)) {
        return false;
      }
      transactionIds.add(tx.transactionId);
    }
    return true;
  }

  // Enhanced consensus with better conflict resolution
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
    addressTransactions.forEach(transaction => {
      if (transaction.recipient === address) {
        balance += transaction.amount;
      } else if (transaction.sender === address) {
        balance -= transaction.amount;
      }
    });

    return {
      addressTransactions,
      addressBalance: balance
    };
  }

  // Network management
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

  // Get blockchain statistics
  getStats() {
    return {
      totalBlocks: this.chain.length,
      pendingTransactions: this.pendingTransactions.length,
      difficulty: this.difficulty,
      networkNodes: this.networkNodes.length,
      totalTransactions: this.chain.reduce((total, block) => total + block.transactions.length, 0)
    };
  }

  // Adjust difficulty based on block time
  adjustDifficulty() {
    if (this.chain.length < 2) return;
    
    const lastBlock = this.getLastBlock();
    const secondLastBlock = this.chain[this.chain.length - 2];
    const timeDiff = lastBlock.timestamp - secondLastBlock.timestamp;
    
    // Target block time: 10 seconds
    const targetTime = 10000;
    
    if (timeDiff < targetTime / 2) {
      this.difficulty++;
    } else if (timeDiff > targetTime * 2) {
      this.difficulty = Math.max(1, this.difficulty - 1);
    }
  }
}

export default Blockchain;
