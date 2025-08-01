
# Ekehi Network Testnet - API Guide

Welcome to the **Ekehi Network Testnet**! This guide will help you interact with the network programmatically.

## Base URL
```
http://your-node-url:5000
```

## Quick Start

### 1. Create a Wallet
```bash
curl http://localhost:5000/wallet/create
```

### 2. Get Testnet Tokens
```bash
curl -X POST http://localhost:5000/api/faucet/request \
  -H "Content-Type: application/json" \
  -d '{"address": "EKH..."}'
```

### 3. Send Transaction
```bash
curl -X POST http://localhost:5000/transaction/send \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10,
    "sender": "EKH...",
    "recipient": "EKH...",
    "fee": 0.001
  }'
```

## API Reference

### Wallet Operations

#### Create Wallet
```http
GET /wallet/create
```
Creates a new EKH wallet with address format: `EKH` + 48 hex characters

#### Validate Address
```http
GET /wallet/validate/:address
```
Validates if an EKH address is properly formatted

#### Get Address Data
```http
GET /address/:address
```
Returns balance, transaction history, and statistics for an address

### Blockchain Operations

#### Get Full Blockchain
```http
GET /blockchain
```
Returns the complete blockchain data

#### Get Statistics
```http
GET /stats
```
Returns network statistics including total supply, blocks, difficulty

#### Get Network Info
```http
GET /network
```
Returns network metadata and configuration

### Transaction Operations

#### Send Transaction
```http
POST /transaction/send
```
Body:
```json
{
  "amount": 10.5,
  "sender": "EKH...",
  "recipient": "EKH...",
  "fee": 0.001
}
```

#### Get Transaction
```http
GET /transaction/:transactionId
```
Returns transaction details and containing block

#### View Mempool
```http
GET /mempool
```
Returns pending transactions waiting to be mined

### Mining Operations

#### Start Auto-Mining
```http
POST /mining/start
```
Starts automatic mining process

#### Stop Auto-Mining
```http
POST /mining/stop
```
Stops automatic mining process

#### Get Mining Status
```http
GET /mining/status
```
Returns current mining status and metrics

### Block Operations

#### Get Block by Hash
```http
GET /block/:blockhash
```
Returns specific block data

#### Get Recent Blocks
```http
GET /api/dashboard/data
```
Returns recent blocks and network statistics

### Network Operations

#### Get Peers
```http
GET /api/network/peers
```
Returns connected network peers

#### Discover Peers
```http
POST /api/network/discover
```
Initiates peer discovery process

### Testnet Features

#### Faucet Request
```http
POST /api/faucet/request
```
Body:
```json
{
  "address": "EKH..."
}
```
Provides 100 EKH tokens for testing (1 hour cooldown)

#### Rich List
```http
GET /richlist
```
Returns top 50 addresses by balance

### Dashboard & Monitoring

#### Dashboard Data
```http
GET /api/dashboard/data
```
Returns comprehensive dashboard data

#### Node Metrics
```http
GET /api/node/metrics
```
Returns node performance metrics

#### Restart Node
```http
POST /api/node/restart
```
Restarts node services

## Web Interfaces

### Dashboard
Visit: `http://localhost:5000/dashboard`
- Real-time network monitoring
- Mining controls
- Testnet faucet
- Wallet generator

### Block Explorer
Visit: `http://localhost:5000/block-explorer`
- Search blocks, transactions, addresses
- Browse blockchain data

## Address Format

Ekehi addresses follow this format:
- Prefix: `EKH`
- Length: 51 characters total
- Structure: `EKH` + 48 hex characters
- Includes checksum validation

Example: `EKH1234567890ABCDEF1234567890ABCDEF12345678FEDCBA09`

## Error Codes

- `400` - Bad Request (invalid data)
- `429` - Too Many Requests (faucet limit)
- `500` - Internal Server Error

## Rate Limits

- Faucet: 1 request per hour per address
- No other rate limits on testnet

## Support

For issues or questions:
1. Check the dashboard for node status
2. Review API documentation at `/api/docs`
3. Monitor logs for error messages

---

**Happy Testing on Ekehi Network!** 🚀
