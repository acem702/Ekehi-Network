
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export class SmartContract {
  constructor(id, code, creator, initialData = {}) {
    this.id = id;
    this.code = code;
    this.creator = creator;
    this.state = { ...initialData };
    this.balance = 0;
    this.created = Date.now();
    this.events = [];
    this.lastExecuted = null;
  }

  // Execute contract method
  execute(method, params = [], caller, value = 0) {
    try {
      // Create a safe execution context
      const context = {
        state: { ...this.state },
        balance: this.balance,
        caller,
        value,
        blockTime: Date.now(),
        emit: (eventName, data) => {
          this.events.push({
            name: eventName,
            data,
            timestamp: Date.now(),
            caller
          });
        }
      };

      // Parse and execute the contract code
      const contractFunction = new Function('context', 'method', 'params', `
        ${this.code}
        
        // Call the requested method
        if (typeof ${method} === 'function') {
          return ${method}.apply(this, params);
        } else {
          throw new Error('Method not found: ' + method);
        }
      `);

      const result = contractFunction.call(context, context, method, params);

      // Update contract state
      this.state = context.state;
      this.balance = context.balance;
      this.lastExecuted = Date.now();

      return {
        success: true,
        result,
        gasUsed: 21000, // Simplified gas calculation
        events: this.events.slice(-10) // Last 10 events
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        gasUsed: 5000
      };
    }
  }

  // Get contract info
  getInfo() {
    return {
      id: this.id,
      creator: this.creator,
      created: this.created,
      lastExecuted: this.lastExecuted,
      balance: this.balance,
      state: this.state,
      eventCount: this.events.length
    };
  }
}

export class ContractSystem {
  constructor(blockchain) {
    this.blockchain = blockchain;
    this.contracts = new Map();
    this.templates = this.getContractTemplates();
  }

  // Deploy a new contract
  deployContract(code, creator, initialData = {}) {
    if (!this.blockchain.isValidAddress(creator)) {
      throw new Error('Invalid creator address');
    }

    const contractId = 'CONTRACT_' + uuidv4().replace(/-/g, '').toUpperCase();
    
    // Validate contract code (basic security check)
    if (!this.validateContractCode(code)) {
      throw new Error('Invalid or unsafe contract code');
    }

    const contract = new SmartContract(contractId, code, creator, initialData);
    this.contracts.set(contractId, contract);

    // Create deployment transaction
    const deployTx = {
      amount: 0,
      sender: creator,
      recipient: contractId,
      fee: 0.01, // Contract deployment fee
      transactionId: uuidv4().split('-').join(''),
      timestamp: Date.now(),
      network: this.blockchain.networkName,
      type: 'CONTRACT_DEPLOY',
      contractId
    };

    return {
      contract,
      transaction: deployTx
    };
  }

  // Execute contract method
  executeContract(contractId, method, params, caller, value = 0) {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new Error('Contract not found');
    }

    if (!this.blockchain.isValidAddress(caller)) {
      throw new Error('Invalid caller address');
    }

    const result = contract.execute(method, params, caller, value);

    // Create execution transaction
    const execTx = {
      amount: value,
      sender: caller,
      recipient: contractId,
      fee: 0.005, // Contract execution fee
      transactionId: uuidv4().split('-').join(''),
      timestamp: Date.now(),
      network: this.blockchain.networkName,
      type: 'CONTRACT_EXECUTE',
      contractId,
      method,
      params,
      result
    };

    return {
      ...result,
      transaction: execTx
    };
  }

  // Get contract
  getContract(contractId) {
    const contract = this.contracts.get(contractId);
    return contract ? contract.getInfo() : null;
  }

  // Get all contracts
  getAllContracts() {
    return Array.from(this.contracts.values()).map(contract => contract.getInfo());
  }

  // Get contract events
  getContractEvents(contractId, eventName = null) {
    const contract = this.contracts.get(contractId);
    if (!contract) return [];

    let events = contract.events;
    if (eventName) {
      events = events.filter(event => event.name === eventName);
    }

    return events.sort((a, b) => b.timestamp - a.timestamp);
  }

  // Validate contract code (basic security)
  validateContractCode(code) {
    // Block dangerous operations
    const dangerousPatterns = [
      /require\s*\(/,
      /import\s+/,
      /eval\s*\(/,
      /Function\s*\(/,
      /process\./,
      /global\./,
      /console\./
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return false;
      }
    }

    // Must contain at least one function
    if (!/function\s+\w+/.test(code)) {
      return false;
    }

    return true;
  }

  // Get contract templates
  getContractTemplates() {
    return {
      token: {
        name: 'Simple Token',
        description: 'A basic ERC-20 style token contract',
        code: `
function constructor(name, symbol, supply) {
  context.state.name = name;
  context.state.symbol = symbol;
  context.state.totalSupply = supply;
  context.state.balances = {};
  context.state.balances[context.caller] = supply;
  context.emit('TokenCreated', { name, symbol, supply });
}

function transfer(to, amount) {
  const from = context.caller;
  if (!context.state.balances[from] || context.state.balances[from] < amount) {
    throw new Error('Insufficient balance');
  }
  
  context.state.balances[from] -= amount;
  context.state.balances[to] = (context.state.balances[to] || 0) + amount;
  
  context.emit('Transfer', { from, to, amount });
  return true;
}

function balanceOf(address) {
  return context.state.balances[address] || 0;
}

function totalSupply() {
  return context.state.totalSupply;
}
        `
      },
      voting: {
        name: 'Simple Voting',
        description: 'A basic voting contract',
        code: `
function constructor(question, options) {
  context.state.question = question;
  context.state.options = options;
  context.state.votes = {};
  context.state.voters = new Set();
  context.state.endTime = context.blockTime + (7 * 24 * 60 * 60 * 1000); // 7 days
  context.emit('VotingStarted', { question, options });
}

function vote(option) {
  if (context.blockTime > context.state.endTime) {
    throw new Error('Voting has ended');
  }
  
  if (context.state.voters.has(context.caller)) {
    throw new Error('Already voted');
  }
  
  if (!context.state.options.includes(option)) {
    throw new Error('Invalid option');
  }
  
  context.state.votes[option] = (context.state.votes[option] || 0) + 1;
  context.state.voters.add(context.caller);
  
  context.emit('VoteCast', { voter: context.caller, option });
  return true;
}

function getResults() {
  return {
    question: context.state.question,
    votes: context.state.votes,
    totalVoters: context.state.voters.size,
    ended: context.blockTime > context.state.endTime
  };
}
        `
      },
      marketplace: {
        name: 'Simple Marketplace',
        description: 'A basic item marketplace contract',
        code: `
function constructor() {
  context.state.items = {};
  context.state.nextId = 1;
  context.emit('MarketplaceCreated', {});
}

function listItem(name, price, description) {
  const itemId = context.state.nextId++;
  context.state.items[itemId] = {
    id: itemId,
    name,
    price,
    description,
    seller: context.caller,
    sold: false,
    listed: context.blockTime
  };
  
  context.emit('ItemListed', { itemId, name, price, seller: context.caller });
  return itemId;
}

function buyItem(itemId) {
  const item = context.state.items[itemId];
  if (!item) {
    throw new Error('Item not found');
  }
  
  if (item.sold) {
    throw new Error('Item already sold');
  }
  
  if (context.value < item.price) {
    throw new Error('Insufficient payment');
  }
  
  item.sold = true;
  item.buyer = context.caller;
  item.soldAt = context.blockTime;
  
  context.emit('ItemSold', { itemId, buyer: context.caller, seller: item.seller });
  return true;
}

function getItem(itemId) {
  return context.state.items[itemId];
}

function getItems() {
  return Object.values(context.state.items);
}
        `
      }
    };
  }
}
