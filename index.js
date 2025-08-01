import express from "express";
import bodyParser from "body-parser";
import Blockchain from "./blockchain.js";
import { v4 as uuidv4 } from 'uuid';
import rp from "request-promise";
import path from "path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const port = process.argv[2];

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

const bitcoin = new Blockchain();

app.get("/", (req, res) => {
  res.send("Let's build a blockchain");
});

app.get("/block-explorer", (req, res) => {
  res.sendFile("./block-explorer/index.html", { root: __dirname });
});

app.get("/blockchain", (req, res) => {
  res.send(bitcoin);
});

app.post("/transaction", (req, res) => {
  const newTransaction = req.body;
  const blockIndex =
    bitcoin.addTransactionToPendingTransactions(newTransaction);
  res.json({
    note: `Transaction will be added in block ${blockIndex}`,
  });
});

app.get("/mine", (req, res) => {
  const lastBlock = bitcoin.getLastBlock();
  const previousBlockHash = lastBlock["hash"];
  const currentBlockData = {
    transactions: bitcoin.pendingTransactions,
    index: lastBlock["index"] + 1,
  };
  const nonce = bitcoin.proofOfWork(previousBlockHash, currentBlockData);
  const blockHash = bitcoin.hashBlock(
    previousBlockHash,
    currentBlockData,
    nonce,
  );
  const nodeAddress = uuid().split("-").join("");
  const newBlock = bitcoin.createNewBlock(nonce, previousBlockHash, blockHash);
  const requestPromises = [];

  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const requestOptions = {
      uri: networkNodeUrl + "/receive-new-block",
      method: "POST",
      body: { newBlock },
      json: true,
    };
    requestPromises.push(rp(requestOptions));
  });

  Promise.all(requestPromises)
    .then((data) => {
      const requestOptions = {
        uri: bitcoin.currentNodeUrl + "/transaction/broadcast",
        method: "POST",
        body: {
          amount: 12.5,
          sender: "00",
          recipient: nodeAddress,
        },
        json: true,
      };
      return rp(requestOptions);
    })
    .then((data) => {
      res.json({
        note: "New block mined & broadcast successfully",
        block: newBlock,
      });
    });
});

app.post("/register-and-broadcast-node", (req, res) => {
  const newNodeUrl = req.body.newNodeUrl;
  if (bitcoin.networkNodes.indexOf(newNodeUrl) == -1)
    bitcoin.networkNodes.push(newNodeUrl);
  const regNodesPromise = [];
  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const requestOptions = {
      uri: networkNodeUrl + "/register-node",
      method: "POST",
      body: {
        newNodeUrl: newNodeUrl,
      },
      json: true,
    };
    regNodesPromise.push(rp(requestOptions));
  });

  Promise.all(regNodesPromise)
    .then((data) => {
      const bulkRegisterOptions = {
        uri: newNodeUrl + "/register-nodes-bulk",
        method: "POST",
        body: {
          allNetworkNodes: [...bitcoin.networkNodes, bitcoin.currentNodeUrl],
        },
        json: true,
      };
      return rp(bulkRegisterOptions);
    })
    .then((data) => {
      res.json({
        note: "New Node registered with network successfully",
      });
    });
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

app.get("/consensus", (req, res) => {
  const requestPromises = [];
  bitcoin.networkNodes.forEach((networkNodeUrl) => {
    const requestOptions = {
      uri: networkNodeUrl + "/blockchain",
      method: "GET",
      json: true,
    };
    requestPromises.push(rp(requestOptions));
  });

  Promise.all(requestPromises).then((blockchains) => {
    const currentChainLength = bitcoin.chain.length;
    let maxChainLength = currentChainLength;
    let newLongestChain = null;
    let newPendingTransactions = null;
    blockchains.forEach((blockchain) => {
      if (blockchain.chain.length > maxChainLength) {
        maxChainLength = blockchain.chain.length;
        newLongestChain = blockchain.chain;
        newPendingTransactions = blockchain.pendingTransactions;
      }
    });

    if (
      !newLongestChain ||
      (newLongestChain && !bitcoin.chainIsValid(newLongestChain))
    ) {
      res.json({
        note: "Current chain has not been replaced.",
        chain: bitcoin.chain,
      });
    } else {
      bitcoin.chain = newLongestChain;
      bitcoin.pendingTransactions = newPendingTransactions;
      res.json({
        note: "This chain has been replaced",
        chain: bitcoin.chain,
      });
    }
  });
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

app.listen(port, () => {
  console.log("Express is listening on port " + port + "...");
});
