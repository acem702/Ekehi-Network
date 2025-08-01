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

app.get("/blockchain", (req, res) => {
  res.send(bitcoin);
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

app.listen(port, '0.0.0.0', () => {
  console.log(`Express is listening on port ${port}...`);
  console.log(`Blockchain initialized with ${bitcoin.chain.length} blocks`);
  console.log(`Node URL: ${bitcoin.currentNodeUrl}`);
});
