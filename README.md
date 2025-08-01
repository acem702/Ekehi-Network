
# Ekehi Network - Blockchain Implementation

A complete blockchain implementation featuring the **Ekehi (EKH)** token with automatic mining, wallet system, and persistent storage.

## Features

### Core Blockchain
- **Network**: Ekehi Network
- **Native Token**: Ekehi (EKH)
- **Consensus**: Proof of Work with adjustable difficulty
- **Block Time**: ~10 seconds target
- **Mining Reward**: 12.5 EKH per block
- **Persistent Storage**: LevelDB integration

### Wallet System
- **Address Format**: EKH + 48 hex characters
- **Address Validation**: Checksum verification
- **Balance Tracking**: Real-time balance calculation
- **Transaction History**: Complete transaction records

### Auto-Mining
- **Automatic Mining**: Mines blocks automatically when transactions are pending
- **Difficulty Adjustment**: Adjusts based on block time
- **Mining Pool**: Configurable miner address
- **Real-time Stats**: Mining status and performance metrics

### Advanced Features
- **Transaction Fees**: Configurable minimum fees (0.001 EKH)
- **Mempool**: Pending transaction pool
- **Rich List**: Top addresses by balance
- **Network Nodes**: Peer-to-peer network support
- **Block Explorer**: Web interface for blockchain data

## API Endpoints

### Blockchain Operations
- `GET /` - Welcome message
- `GET /blockchain` - Get full blockchain
- `GET /stats` - Blockchain statistics
- `GET /network` - Network information

### Wallet Management
- `GET /wallet/create` - Create new EKH wallet
- `GET /wallet/validate/:address` - Validate wallet address
- `GET /address/:address` - Get address data and balance

### Transactions
- `POST /transaction/send` - Send EKH tokens
- `POST /transaction` - Add transaction to pending pool
- `GET /transaction/:transactionId` - Get transaction details
- `GET /mempool` - View pending transactions

### Mining
- `GET /mine` - Manual mining (single block)
- `POST /mining/start` - Start auto-mining
- `POST /mining/stop` - Stop auto-mining  
- `GET /mining/status` - Mining status

### Network & Consensus
- `POST /register-and-broadcast-node` - Register network node
- `GET /consensus` - Consensus mechanism
- `GET /richlist` - Top addresses by balance

### Block Explorer
- `GET /block-explorer` - Web interface
- `GET /block/:blockhash` - Get specific block

## Getting Started

### Installation
```bash
npm install
```

### Run Single Node
```bash
node index.js 5000 http://localhost:5000
```

### Run Network (Multiple Nodes)
```bash
# Node 1
node index.js 5001 http://localhost:5001

# Node 2  
node index.js 5002 http://localhost:5002

# Node 3
node index.js 5003 http://localhost:5003
```

### Register Network Nodes
```bash
# Register Node 2 with Node 1
curl -X POST http://localhost:5001/register-and-broadcast-node \
  -H "Content-Type: application/json" \
  -d '{"newNodeUrl": "http://localhost:5002"}'

# Register Node 3 with Node 1  
curl -X POST http://localhost:5001/register-and-broadcast-node \
  -H "Content-Type: application/json" \
  -d '{"newNodeUrl": "http://localhost:5003"}'
```

## Usage Examples

### Create Wallet
```bash
curl http://localhost:5000/wallet/create
```

### Send Transaction
```bash
curl -X POST http://localhost:5000/transaction/send \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10,
    "sender": "EKH1234567890ABCDEF...",
    "recipient": "EKH0987654321FEDCBA...",
    "fee": 0.001
  }'
```

### Check Balance
```bash
curl http://localhost:5000/address/EKH1234567890ABCDEF...
```

### View Blockchain Stats  
```bash
curl http://localhost:5000/stats
```

## Technical Details

### Address Generation
- Uses SHA-256 for address hashing
- 4-byte checksum for validation
- EKH prefix for network identification

### Mining Algorithm
- SHA-256 based Proof of Work
- Dynamic difficulty adjustment
- Automatic mining every 5 seconds when transactions pending

### Database Structure
- LevelDB for persistent storage
- Stores blockchain, pending transactions, network nodes
- Configuration persistence

### Security Features
- Transaction validation
- Double-spend prevention
- Address format validation
- Network consensus mechanism

## Development

### Project Structure
```
├── blockchain.js      # Core blockchain implementation
├── index.js          # Express API server
├── package.json      # Dependencies
├── block-explorer/   # Web interface
└── blockchain-db/    # LevelDB database
```

### Key Classes
- `Blockchain` - Main blockchain class with all functionality
- Auto-mining, wallet management, consensus, persistence

## License

MIT License - Feel free to use for educational or commercial purposes.

---

**Ekehi Network** - A complete blockchain solution with native EKH token support.
