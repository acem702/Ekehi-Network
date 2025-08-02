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
