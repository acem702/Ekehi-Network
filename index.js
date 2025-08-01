import express from "express";
import bodyParser from "body-parser";
import Blockchain from "./blockchain.js";
import { v4 as uuidv4 } from 'uuid';
import rp from "request-promise";
import path from "path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const port = process.argv[2] || 5000;

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const bitcoin = new Blockchain();

// Wait for blockchain initialization
await bitcoin.initializeBlockchain();

app.get("/", (req, res) => {
  res.send("Let's build a blockchain");
});

app.get("/block-explorer", (req, res) => {
  res.sendFile("./block-explorer/index.html", { root: __dirname });
});

// Block explorer data endpoint
app.get("/api/explorer/data", async (req, res) => {
  try {
    // Ensure blockchain is loaded
    if (!bitcoin.chain || bitcoin.chain.length === 0) {
      return res.status(200).json({
        blocks: [],
        transactions: [],
        stats: { 
          totalBlocks: 0, 
          totalTransactions: 0,
          totalSupply: 0,
          difficulty: bitcoin.difficulty || 1
        },
        isReady: false,
        message: 'Blockchain not yet initialized'
      });
    }

    // Get recent blocks (latest first)
    const recentBlocks = bitcoin.chain.slice().reverse().slice(0, 20);
    const allTransactions = [];
    
    bitcoin.chain.forEach(block => {
      if (block.transactions && Array.isArray(block.transactions)) {
        block.transactions.forEach(tx => {
          allTransactions.push({
            ...tx,
            blockIndex: block.index,
            blockHash: block.hash || '0',
            blockTimestamp: block.timestamp
          });
        });
      }
    });
    
    // Sort transactions by timestamp (latest first)
    const recentTransactions = allTransactions
      .sort((a, b) => (b.timestamp || b.blockTimestamp || 0) - (a.timestamp || a.blockTimestamp || 0))
      .slice(0, 50);
    
    res.json({
      blocks: recentBlocks.map(block => ({
        index: block.index || 0,
        hash: block.hash || '0',
        timestamp: block.timestamp || Date.now(),
        transactions: (block.transactions && block.transactions.length) || 0,
        difficulty: block.difficulty || bitcoin.difficulty,
        nonce: block.nonce || 0,
        previousBlockHash: block.previousBlockHash || '0'
      })),
      transactions: recentTransactions.map(tx => ({
        transactionId: tx.transactionId || 'N/A',
        amount: tx.amount || 0,
        sender: tx.sender || 'Unknown',
        recipient: tx.recipient || 'Unknown',
        timestamp: tx.timestamp || tx.blockTimestamp || Date.now(),
        fee: tx.fee || 0,
        blockIndex: tx.blockIndex || 0
      })),
      stats: bitcoin.getStats(),
      isReady: true
    });
  } catch (error) {
    console.error('Explorer data error:', error);
    res.status(200).json({
      blocks: [],
      transactions: [],
      stats: { 
        totalBlocks: bitcoin.chain ? bitcoin.chain.length : 0, 
        totalTransactions: 0,
        totalSupply: 0,
        difficulty: bitcoin.difficulty || 1
      },
      isReady: true,
      error: error.message
    });
  }
});

app.get("/blockchain", (req, res) => {
  // Send clean blockchain data without circular references
  const cleanBlockchain = {
    chain: bitcoin.chain,
    pendingTransactions: bitcoin.pendingTransactions,
    difficulty: bitcoin.difficulty,
    networkName: bitcoin.networkName,
    tokenName: bitcoin.tokenName,
    tokenSymbol: bitcoin.tokenSymbol,
    miningReward: bitcoin.miningReward
  };
  res.json(cleanBlockchain);
});

app.post("/transaction", async (req, res) => {
  try {
    const newTransaction = req.body;
    
    // Validate transaction structure
    if (!newTransaction.amount || !newTransaction.sender || !newTransaction.recipient) {
      return res.status(400).json({ error: 'Invalid transaction data' });
    }
    
    const blockIndex = await bitcoin.addTransactionToPendingTransactions(newTransaction);
    res.json({
      note: `Transaction will be added in block ${blockIndex}`,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/mine", async (req, res) => {
  try {
    if (bitcoin.pendingTransactions.length === 0) {
      return res.status(400).json({ error: 'No pending transactions to mine' });
    }

    const lastBlock = bitcoin.getLastBlock();
    const previousBlockHash = lastBlock["hash"];
    const currentBlockData = {
      transactions: bitcoin.pendingTransactions.slice(0, bitcoin.maxTransactionsPerBlock),
      index: lastBlock["index"] + 1,
    };
    
    console.log('Starting mining process...');
    const nonce = bitcoin.proofOfWork(previousBlockHash, currentBlockData);
    const blockHash = bitcoin.hashBlock(previousBlockHash, currentBlockData, nonce);
    
    const nodeAddress = uuidv4().split("-").join("");
    const newBlock = await bitcoin.createNewBlock(nonce, previousBlockHash, blockHash);
    
    // Adjust difficulty for next block
    bitcoin.adjustDifficulty();
    
    const requestPromises = [];

    bitcoin.networkNodes.forEach((networkNodeUrl) => {
      const requestOptions = {
        uri: networkNodeUrl + "/receive-new-block",
        method: "POST",
        body: { newBlock },
        json: true,
        timeout: 5000
      };
      requestPromises.push(rp(requestOptions).catch(err => {
        console.error(`Failed to broadcast to ${networkNodeUrl}:`, err.message);
        return null;
      }));
    });

    Promise.all(requestPromises)
      .then(async (data) => {
        // Create mining reward transaction
        const rewardTransaction = bitcoin.createNewTransaction(
          bitcoin.miningReward,
          "00",
          nodeAddress
        );
        
        await bitcoin.addTransactionToPendingTransactions(rewardTransaction);
        
        const requestOptions = {
          uri: bitcoin.currentNodeUrl + "/transaction/broadcast",
          method: "POST",
          body: rewardTransaction,
          json: true,
        };
        return rp(requestOptions).catch(err => {
          console.error('Failed to broadcast reward transaction:', err.message);
          return null;
        });
      })
      .then((data) => {
        res.json({
          note: "New block mined & broadcast successfully",
          block: newBlock,
          stats: bitcoin.getStats()
        });
      })
      .catch(err => {
        console.error('Mining broadcast error:', err);
        res.json({
          note: "Block mined but broadcast failed",
          block: newBlock,
          stats: bitcoin.getStats()
        });
      });
  } catch (error) {
    console.error('Mining error:', error);
    res.status(500).json({ error: 'Mining failed', message: error.message });
  }
});

app.post("/register-and-broadcast-node", async (req, res) => {
  try {
    const newNodeUrl = req.body.newNodeUrl;
    
    if (!newNodeUrl) {
      return res.status(400).json({ error: 'Node URL is required' });
    }
    
    await bitcoin.addNetworkNode(newNodeUrl);
    
    const regNodesPromise = [];
    bitcoin.networkNodes.forEach((networkNodeUrl) => {
      if (networkNodeUrl !== newNodeUrl) {
        const requestOptions = {
          uri: networkNodeUrl + "/register-node",
          method: "POST",
          body: { newNodeUrl: newNodeUrl },
          json: true,
          timeout: 5000
        };
        regNodesPromise.push(
          rp(requestOptions).catch(err => {
            console.error(`Failed to register with ${networkNodeUrl}:`, err.message);
            return null;
          })
        );
      }
    });

    await Promise.all(regNodesPromise);
    
    const bulkRegisterOptions = {
      uri: newNodeUrl + "/register-nodes-bulk",
      method: "POST",
      body: {
        allNetworkNodes: [...bitcoin.networkNodes, bitcoin.currentNodeUrl],
      },
      json: true,
      timeout: 5000
    };
    
    await rp(bulkRegisterOptions).catch(err => {
      console.error(`Failed bulk registration with ${newNodeUrl}:`, err.message);
    });
    
    res.json({
      note: "New Node registered with network successfully",
      networkSize: bitcoin.networkNodes.length
    });
  } catch (error) {
    console.error('Node registration error:', error);
    res.status(500).json({ error: 'Node registration failed', message: error.message });
  }
});

app.post("/register-node", (req, res) => {
  const newNodeUrl = req.body.newNodeUrl;
  const notCurrentNode = bitcoin.currentNodeUrl !== newNodeUrl;
  const nodeNotAlreadyPresent = bitcoin.networkNodes.indexOf(newNodeUrl) == -1;
  if (nodeNotAlreadyPresent && notCurrentNode)
    bitcoin.networkNodes.push(newNodeUrl);
  res.json({ note: "New Node registered successfully" });
});

app.post("/register-nodes-bulk", (req, res) => {
  const allNetworkNodes = req.body.allNetworkNodes;
  allNetworkNodes.forEach((networkNodeUrl) => {
    const nodeNotAlreadyPresent =
      bitcoin.networkNodes.indexOf(networkNodeUrl) == -1;
    const notCurrentNode = bitcoin.currentNodeUrl !== networkNodeUrl;
    if (nodeNotAlreadyPresent && notCurrentNode)
      bitcoin.networkNodes.push(networkNodeUrl);
  });
  res.json({ note: "Bulk registration successful." });
});

app.post("/transaction/broadcast", (req, res) => {
  const newTransaction = bitcoin.createNewTransaction(
    req.body.amount,
    req.body.sender,
    req.body.recipient,
  );
  bitcoin.addTransactionToPendingTransactions(newTransaction);
  const requestPromises = [];
  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const requestOptions = {
      uri: networkNodeUrl + "/transaction",
      method: "POST",
      body: newTransaction,
      json: true,
    };
    requestPromises.push(rp(requestOptions));
  });

  Promise.all(requestPromises)
    .then((data) => {
      res.json({
        note: "Transaction created and broadcasted successfully",
      });
    })
    .catch((error) => console.error(error));
});

app.post("/receive-new-block", (req, res) => {
  const newBlock = req.body.newBlock;
  const lastBlock = bitcoin.getLastBlock();
  const correctHash = lastBlock.hash === newBlock.previousBlockHash;
  const correctIndex = lastBlock["index"] + 1 === newBlock["index"];

  if (correctHash && correctIndex) {
    bitcoin.chain.push(newBlock);
    bitcoin.pendingTransactions = [];
    res.json({
      note: "New block received and accepted",
      newBlock: newBlock,
    });
  } else {
    res.json({
      note: "New block rejected",
      newBlock,
    });
  }
});

app.get("/consensus", async (req, res) => {
  try {
    const requestPromises = [];
    bitcoin.networkNodes.forEach((networkNodeUrl) => {
      const requestOptions = {
        uri: networkNodeUrl + "/blockchain",
        method: "GET",
        json: true,
        timeout: 5000
      };
      requestPromises.push(
        rp(requestOptions).catch(err => {
          console.error(`Failed to fetch blockchain from ${networkNodeUrl}:`, err.message);
          return null;
        })
      );
    });

    const responses = await Promise.all(requestPromises);
    const blockchains = responses.filter(response => response !== null);

    if (blockchains.length === 0) {
      return res.json({
        note: "No network nodes responded",
        chain: bitcoin.chain,
        stats: bitcoin.getStats()
      });
    }

    const chainReplaced = await bitcoin.resolveConflicts(blockchains);

    if (chainReplaced) {
      res.json({
        note: "Chain has been replaced with longer valid chain",
        chain: bitcoin.chain,
        stats: bitcoin.getStats()
      });
    } else {
      res.json({
        note: "Current chain retained - no longer valid chain found",
        chain: bitcoin.chain,
        stats: bitcoin.getStats()
      });
    }
  } catch (error) {
    console.error('Consensus error:', error);
    res.status(500).json({ error: 'Consensus failed', message: error.message });
  }
});

app.get("/block/:blockhash", (req, res) => {
  const blockHash = req.params.blockhash;
  const correctBlock = bitcoin.getBlock(blockHash);
  res.json({
    block: correctBlock,
  });
});

app.get("/transaction/:transactionId", (req, res) => {
  const transactionId = req.params.transactionId;
  const transactionData = bitcoin.getTransaction(transactionId);
  return res.json(transactionData);
});

app.get("/address/:address", (req, res) => {
  const address = req.params.address;
  const addressData = bitcoin.getAddressData(address);
  res.json({
    addressData,
  });
});

app.get("/stats", (req, res) => {
  res.json(bitcoin.getStats());
});

// Wallet endpoints
app.get("/wallet/create", (req, res) => {
  try {
    const wallet = bitcoin.createWallet();
    res.json({
      success: true,
      wallet,
      message: `New ${bitcoin.tokenSymbol} wallet created successfully`
    });
  } catch (error) {
    res.status(500).json({ error: 'Wallet creation failed', message: error.message });
  }
});

app.get("/wallet/validate/:address", (req, res) => {
  const address = req.params.address;
  const isValid = bitcoin.isValidAddress(address);
  res.json({
    address,
    valid: isValid,
    network: bitcoin.networkName
  });
});

// Ecosystem page
app.get("/ecosystem", (req, res) => {
  res.sendFile("./ecosystem/index.html", { root: __dirname });
});

// Wallet recovery endpoint
app.post("/api/wallet/recover", (req, res) => {
  try {
    const { privateKey } = req.body;
    
    if (!privateKey) {
      return res.status(400).json({ error: 'Private key is required' });
    }
    
    const wallet = bitcoin.recoverWalletFromPrivateKey(privateKey);
    res.json({
      success: true,
      wallet,
      message: 'Wallet recovered successfully'
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Network info endpoint
app.get("/network", (req, res) => {
  res.json(bitcoin.getNetworkInfo());
});

// Mining control endpoints
app.post("/mining/start", (req, res) => {
  try {
    if (!bitcoin.autoMining) {
      bitcoin.autoMining = true;
      bitcoin.startAutoMining();
      res.json({ message: 'Auto-mining started', status: 'active' });
    } else {
      res.json({ message: 'Auto-mining already active', status: 'active' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to start mining', message: error.message });
  }
});

// Enhanced ecosystem reward system
app.post("/api/rewards/claim", async (req, res) => {
  try {
    const { address, activity } = req.body;
    
    if (!address || !bitcoin.isValidAddress(address)) {
      return res.status(400).json({ error: 'Valid EKH address required' });
    }

    const rewardSystem = {
      'create-wallet': { amount: 5, description: 'Create first wallet' },
      'first-transaction': { amount: 10, description: 'Send first transaction' },
      'explore-blockchain': { amount: 10, description: 'Use block explorer' },
      'join-community': { amount: 15, description: 'Join community' },
      'daily-checkin': { amount: 2, description: 'Daily check-in' },
      'share-network': { amount: 20, description: 'Share referral link' },
      'active-user': { amount: 5, description: 'Daily activity bonus' },
      'transaction-volume': { amount: 3, description: 'Transaction activity' }
    };

    const reward = rewardSystem[activity];
    if (!reward) {
      return res.status(400).json({ error: 'Invalid activity type' });
    }

    // Check if already claimed (except daily activities)
    const dailyActivities = ['daily-checkin', 'active-user', 'transaction-volume'];
    if (!dailyActivities.includes(activity)) {
      const addressData = bitcoin.getAddressData(address);
      const alreadyClaimed = addressData.addressTransactions.some(tx => 
        tx.sender === 'ECOSYSTEM' && tx.activityType === activity
      );
      
      if (alreadyClaimed) {
        return res.status(429).json({ error: 'Reward already claimed for this activity' });
      }
    } else {
      // For daily activities, check if claimed today
      const addressData = bitcoin.getAddressData(address);
      const today = new Date().toDateString();
      const claimedToday = addressData.addressTransactions.some(tx => 
        tx.sender === 'ECOSYSTEM' && 
        tx.activityType === activity && 
        new Date(tx.timestamp).toDateString() === today
      );
      
      if (claimedToday) {
        return res.status(429).json({ 
          error: `${reward.description} reward already claimed today` 
        });
      }
    }

    // Create reward transaction
    const rewardTransaction = {
      amount: reward.amount,
      sender: 'ECOSYSTEM',
      recipient: address,
      fee: 0,
      transactionId: uuidv4().split('-').join(''),
      timestamp: Date.now(),
      network: bitcoin.networkName,
      activityType: activity,
      description: reward.description
    };
    
    await bitcoin.addTransactionToPendingTransactions(rewardTransaction);
    
    res.json({
      success: true,
      amount: reward.amount,
      activity: reward.description,
      transaction: rewardTransaction.transactionId,
      message: `${reward.amount} ${bitcoin.tokenSymbol} reward claimed!`
    });
  } catch (error) {
    console.error('Reward claim error:', error);
    res.status(500).json({ error: 'Failed to claim reward', message: error.message });
  }
});

// Auto-reward system for user activities
app.post("/api/rewards/auto-claim", async (req, res) => {
  try {
    const { address, activities } = req.body;
    
    if (!address || !bitcoin.isValidAddress(address)) {
      return res.status(400).json({ error: 'Valid EKH address required' });
    }

    const claimedRewards = [];
    
    for (const activity of activities) {
      try {
        const response = await fetch(`${req.protocol}://${req.get('host')}/api/rewards/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, activity })
        });

// Smart Contract endpoints
app.post("/api/contracts/deploy", async (req, res) => {
  try {
    const { code, creator, initialData } = req.body;
    
    if (!code || !creator) {
      return res.status(400).json({ error: 'Code and creator required' });
    }
    
    if (!bitcoin.isValidAddress(creator)) {
      return res.status(400).json({ error: 'Invalid creator address' });
    }
    
    const contract = bitcoin.createContract(code, creator, initialData || {});
    
    res.json({
      success: true,
      contract: {
        id: contract.id,
        creator: contract.creator,
        created: contract.created
      },
      message: 'Contract deployed successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Contract deployment failed', message: error.message });
  }
});

app.post("/api/contracts/execute", async (req, res) => {
  try {
    const { contractId, method, params, caller, value } = req.body;
    
    if (!contractId || !method || !caller) {
      return res.status(400).json({ error: 'Contract ID, method, and caller required' });
    }
    
    if (!bitcoin.isValidAddress(caller)) {
      return res.status(400).json({ error: 'Invalid caller address' });
    }
    
    const result = bitcoin.executeContract(contractId, method, params || [], caller, value || 0);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Contract execution failed', message: error.message });
  }
});

app.get("/api/contracts/:contractId", (req, res) => {
  try {
    const contract = bitcoin.getContract(req.params.contractId);
    
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }
    
    res.json({ contract });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get contract', message: error.message });
  }
});

app.get("/api/contracts/:contractId/events", (req, res) => {
  try {
    const { eventName } = req.query;
    const events = bitcoin.getContractEvents(req.params.contractId, eventName);
    
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get contract events', message: error.message });
  }
});

// Example contract templates
app.get("/api/contracts/templates", (req, res) => {
  const templates = bitcoin.contractSystem.getTemplates();
  res.json({ templates });
});


        
        if (response.ok) {
          const result = await response.json();
          claimedRewards.push(result);
        }
      } catch (error) {
        console.log(`Failed to claim ${activity}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      claimed: claimedRewards,
      totalAmount: claimedRewards.reduce((sum, r) => sum + r.amount, 0)
    });
  } catch (error) {
    res.status(500).json({ error: 'Auto-claim failed', message: error.message });
  }
});



app.post("/mining/stop", (req, res) => {
  try {
    bitcoin.autoMining = false;
    bitcoin.stopAutoMining();
    res.json({ message: 'Auto-mining stopped', status: 'stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop mining', message: error.message });
  }
});

app.get("/mining/status", (req, res) => {
  res.json({
    autoMining: bitcoin.autoMining,
    isMining: bitcoin.isMining,
    minerAddress: bitcoin.minerAddress,
    pendingTransactions: bitcoin.pendingTransactions.length,
    difficulty: bitcoin.difficulty
  });
});

// Enhanced transaction endpoint with fee support
app.post("/transaction/send", async (req, res) => {
  try {
    const { amount, sender, recipient, fee } = req.body;
    
    if (!bitcoin.isValidAddress(sender) || !bitcoin.isValidAddress(recipient)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    
    if (!amount || !sender || !recipient) {
      return res.status(400).json({ error: 'Amount, sender, and recipient are required' });
    }
    
    const newTransaction = bitcoin.createNewTransaction(amount, sender, recipient, fee);
    const blockIndex = await bitcoin.addTransactionToPendingTransactions(newTransaction);
    
    res.json({
      success: true,
      transaction: newTransaction,
      note: `Transaction will be added in block ${blockIndex}`,
      estimatedConfirmation: 'Next block (~10 seconds)'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Mempool endpoint
app.get("/mempool", (req, res) => {
  res.json({
    pendingTransactions: bitcoin.pendingTransactions,
    count: bitcoin.pendingTransactions.length,
    totalValue: bitcoin.pendingTransactions.reduce((total, tx) => total + tx.amount, 0),
    totalFees: bitcoin.pendingTransactions.reduce((total, tx) => total + (tx.fee || 0), 0)
  });
});

// Rich list endpoint (top addresses by balance)
app.get("/richlist", (req, res) => {
  try {
    const addresses = new Set();
    
    // Collect all addresses
    bitcoin.chain.forEach(block => {
      block.transactions.forEach(tx => {
        if (tx.sender !== '00') addresses.add(tx.sender);
        addresses.add(tx.recipient);
      });
    });
    
    // Calculate balances and sort
    const addressBalances = Array.from(addresses)
      .map(address => ({
        address,
        ...bitcoin.getAddressData(address)
      }))
      .filter(data => data.addressBalance > 0)
      .sort((a, b) => b.addressBalance - a.addressBalance)
      .slice(0, 50); // Top 50
    
    res.json({
      richList: addressBalances,
      totalAddresses: addresses.size,
      token: bitcoin.tokenSymbol
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate rich list', message: error.message });
  }
});

// Ecosystem rewards system
app.post("/api/ecosystem/claim-reward", async (req, res) => {
  try {
    const { address, activity } = req.body;
    
    if (!address || !bitcoin.isValidAddress(address)) {
      return res.status(400).json({ error: 'Valid EKH address required' });
    }

    const rewardAmounts = {
      'create-wallet': 5,
      'first-transaction': 10,
      'explore-blockchain': 10,
      'join-community': 15,
      'daily-checkin': 2,
      'share-network': 20
    };

    const rewardAmount = rewardAmounts[activity];
    if (!rewardAmount) {
      return res.status(400).json({ error: 'Invalid activity' });
    }

    // Check if user already claimed this reward (except daily checkin)
    if (activity !== 'daily-checkin') {
      const addressData = bitcoin.getAddressData(address);
      const alreadyClaimed = addressData.addressTransactions.some(tx => 
        tx.sender === 'ECOSYSTEM' && tx.activity === activity
      );
      
      if (alreadyClaimed) {
        return res.status(429).json({ error: 'Reward already claimed for this activity' });
      }
    } else {
      // For daily checkin, check if claimed today
      const addressData = bitcoin.getAddressData(address);
      const today = new Date().toDateString();
      const claimedToday = addressData.addressTransactions.some(tx => 
        tx.sender === 'ECOSYSTEM' && 
        tx.activity === activity && 
        new Date(tx.timestamp).toDateString() === today
      );
      
      if (claimedToday) {
        return res.status(429).json({ error: 'Daily reward already claimed today' });
      }
    }

    // Create ecosystem reward transaction
    const rewardTransaction = {
      amount: rewardAmount,
      sender: 'ECOSYSTEM',
      recipient: address,
      fee: 0,
      transactionId: uuidv4().split('-').join(''),
      timestamp: Date.now(),
      network: bitcoin.networkName,
      activity: activity
    };
    
    await bitcoin.addTransactionToPendingTransactions(rewardTransaction);
    
    res.json({
      success: true,
      amount: rewardAmount,
      activity: activity,
      transaction: rewardTransaction.transactionId,
      message: `${rewardAmount} ${bitcoin.tokenSymbol} reward claimed for ${activity}!`
    });
  } catch (error) {
    console.error('Ecosystem reward error:', error);
    res.status(500).json({ error: 'Failed to claim reward', message: error.message });
  }
});

// Enhanced dashboard and monitoring endpoints
app.get("/dashboard", (req, res) => {
  res.sendFile("./dashboard/index.html", { root: __dirname });
});

app.get("/api/dashboard/data", async (req, res) => {
  try {
    // Ensure blockchain is ready
    if (!bitcoin.chain || bitcoin.chain.length === 0) {
      return res.json({
        network: { 
          name: bitcoin.networkName || 'Ekehi Network', 
          token: { 
            name: bitcoin.tokenName || 'Ekehi', 
            symbol: bitcoin.tokenSymbol || 'EKH' 
          } 
        },
        stats: { 
          totalBlocks: 0, 
          totalSupply: 0, 
          networkNodes: 0, 
          pendingTransactions: 0 
        },
        metrics: { uptime: 0, hashRate: 0 },
        recentBlocks: [],
        recentTransactions: [],
        networkNodes: 0,
        lastUpdate: Date.now(),
        mempoolSize: 0,
        isReady: false,
        message: 'Blockchain initializing...'
      });
    }

    // Get recent blocks (latest first)
    const recentBlocks = bitcoin.chain.slice().reverse().slice(0, 10);
    const recentPendingTx = bitcoin.pendingTransactions ? bitcoin.pendingTransactions.slice().reverse().slice(0, 20) : [];
    
    const dashboardData = {
      network: bitcoin.getNetworkInfo(),
      stats: bitcoin.getStats(),
      metrics: bitcoin.getNodeMetrics(),
      recentBlocks: recentBlocks.map(block => ({
        index: block.index || 0,
        hash: block.hash && block.hash !== '0' ? (block.hash.substring(0, 16) + '...') : 'Genesis',
        fullHash: block.hash || '0',
        timestamp: block.timestamp || Date.now(),
        transactions: (block.transactions && block.transactions.length) || 0,
        difficulty: block.difficulty || bitcoin.difficulty,
        nonce: block.nonce || 0
      })),
      recentTransactions: recentPendingTx.map(tx => ({
        id: tx.transactionId ? (tx.transactionId.substring(0, 16) + '...') : 'N/A',
        fullId: tx.transactionId || 'N/A',
        amount: tx.amount || 0,
        sender: tx.sender && tx.sender.length > 16 ? (tx.sender.substring(0, 16) + '...') : (tx.sender || 'Unknown'),
        recipient: tx.recipient && tx.recipient.length > 16 ? (tx.recipient.substring(0, 16) + '...') : (tx.recipient || 'Unknown'),
        timestamp: tx.timestamp || Date.now(),
        fee: tx.fee || 0
      })),
      networkNodes: bitcoin.networkNodes ? bitcoin.networkNodes.length : 0,
      lastUpdate: Date.now(),
      mempoolSize: bitcoin.pendingTransactions ? bitcoin.pendingTransactions.length : 0,
      isReady: true
    };
    
    res.json(dashboardData);
  } catch (error) {
    console.error('Dashboard data error:', error);
    res.status(200).json({ 
      network: { 
        name: bitcoin.networkName || 'Ekehi Network', 
        token: { 
          name: bitcoin.tokenName || 'Ekehi', 
          symbol: bitcoin.tokenSymbol || 'EKH' 
        } 
      },
      stats: { 
        totalBlocks: bitcoin.chain ? bitcoin.chain.length : 0, 
        totalSupply: 0, 
        networkNodes: bitcoin.networkNodes ? bitcoin.networkNodes.length : 0, 
        pendingTransactions: bitcoin.pendingTransactions ? bitcoin.pendingTransactions.length : 0 
      },
      metrics: { uptime: 0, hashRate: 0 },
      recentBlocks: [],
      recentTransactions: [],
      networkNodes: bitcoin.networkNodes ? bitcoin.networkNodes.length : 0,
      lastUpdate: Date.now(),
      mempoolSize: bitcoin.pendingTransactions ? bitcoin.pendingTransactions.length : 0,
      isReady: true,
      error: error.message
    });
  }
});

// Node management endpoints
app.get("/api/node/metrics", (req, res) => {
  res.json(bitcoin.getNodeMetrics());
});

app.post("/api/node/restart", (req, res) => {
  try {
    bitcoin.stopAllProcesses();
    setTimeout(() => {
      bitcoin.startAutoMining();
      bitcoin.startPeerDiscovery();
      bitcoin.startMetricsCollection();
    }, 1000);
    
    res.json({ message: 'Node services restarted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart node', message: error.message });
  }
});

app.get("/api/network/peers", (req, res) => {
  res.json({
    peers: bitcoin.networkNodes.map(node => ({
      url: node,
      status: 'connected', // In real implementation, ping to check
      lastSeen: Date.now()
    })),
    maxPeers: bitcoin.maxPeers,
    discoveryEnabled: bitcoin.discoveryInterval !== null
  });
});

app.post("/api/network/discover", async (req, res) => {
  try {
    await bitcoin.discoverPeers();
    res.json({ 
      message: 'Peer discovery initiated',
      currentPeers: bitcoin.networkNodes.length 
    });
  } catch (error) {
    res.status(500).json({ error: 'Peer discovery failed', message: error.message });
  }
});

// Testnet faucet endpoint
app.post("/api/faucet/request", async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Address is required' });
    }
    
    if (!bitcoin.isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid EKH address format. Address must start with EKH' });
    }
    
    // Check if address already received faucet tokens recently
    const addressData = bitcoin.getAddressData(address);
    const recentFaucetTx = addressData.addressTransactions.find(tx => 
      tx.sender === 'FAUCET' && (Date.now() - tx.timestamp) < 3600000 // 1 hour
    );
    
    if (recentFaucetTx) {
      return res.status(429).json({ 
        error: 'Faucet limit reached. Try again in 1 hour.',
        nextRequestTime: new Date(recentFaucetTx.timestamp + 3600000).toISOString()
      });
    }
    
    const faucetAmount = 100; // 100 EKH
    
    // Create faucet transaction with special sender
    const faucetTransaction = {
      amount: faucetAmount,
      sender: 'FAUCET',
      recipient: address,
      fee: 0,
      transactionId: uuidv4().split('-').join(''),
      timestamp: Date.now(),
      network: bitcoin.networkName
    };
    
    await bitcoin.addTransactionToPendingTransactions(faucetTransaction);
    
    res.json({
      success: true,
      amount: faucetAmount,
      transaction: faucetTransaction.transactionId,
      message: `${faucetAmount} ${bitcoin.tokenSymbol} sent to ${address}`,
      estimatedConfirmation: 'Next block (~10 seconds)'
    });
  } catch (error) {
    console.error('Faucet error:', error);
    res.status(500).json({ error: 'Faucet request failed', message: error.message });
  }
});

// API documentation endpoint
app.get("/api/docs", (req, res) => {
  res.json({
    name: "Ekehi Network Testnet API",
    version: "1.0.0-testnet",
    endpoints: {
      blockchain: {
        "GET /": "Welcome message",
        "GET /blockchain": "Get full blockchain",
        "GET /stats": "Blockchain statistics",
        "GET /network": "Network information"
      },
      wallet: {
        "GET /wallet/create": "Create new wallet",
        "GET /wallet/validate/:address": "Validate address",
        "GET /address/:address": "Get address data"
      },
      transactions: {
        "POST /transaction/send": "Send transaction",
        "GET /transaction/:id": "Get transaction",
        "GET /mempool": "View pending transactions"
      },
      mining: {
        "POST /mining/start": "Start auto-mining",
        "POST /mining/stop": "Stop auto-mining",
        "GET /mining/status": "Mining status"
      },
      testnet: {
        "POST /api/faucet/request": "Request testnet tokens",
        "GET /api/dashboard/data": "Dashboard data",
        "GET /api/node/metrics": "Node metrics"
      }
    }
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log('🚀 ===================================');
  console.log(`🌐 ${bitcoin.networkName} TESTNET LAUNCHED`);
  console.log('🚀 ===================================');
  console.log(`📡 Server: http://0.0.0.0:${port}`);  
  console.log(`📊 Dashboard: http://0.0.0.0:${port}/dashboard`);
  console.log(`🔍 Explorer: http://0.0.0.0:${port}/block-explorer`);
  console.log(`📖 API Docs: http://0.0.0.0:${port}/api/docs`);
  console.log('');
  console.log(`⛏️  Auto-mining: ${bitcoin.autoMining ? '✅ ACTIVE' : '❌ DISABLED'}`);
  console.log(`🔗 Peer discovery: ✅ ACTIVE`);
  console.log(`💰 Faucet: ✅ AVAILABLE`);
  console.log(`🪙 Token: ${bitcoin.tokenName} (${bitcoin.tokenSymbol})`);
  console.log(`📦 Blocks: ${bitcoin.chain.length}`);
  console.log(`🏠 Miner: ${bitcoin.minerAddress}`);
  console.log('');
  console.log('🎉 TESTNET READY FOR USERS!');
  console.log('=====================================');
});
