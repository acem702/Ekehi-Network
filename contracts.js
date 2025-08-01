
import { v4 as uuidv4 } from 'uuid';

export class ContractSystem {
  constructor(blockchain) {
    this.blockchain = blockchain;
    this.contracts = new Map();
    this.contractStorage = new Map();
    this.contractEvents = [];
  }

  createContract(contractCode, creator, initialData = {}) {
    const contractId = uuidv4().split('-').join('');
    const contract = {
      id: contractId,
      code: contractCode,
      creator,
      created: Date.now(),
      state: 'active',
      storage: initialData,
      balance: 0,
      network: this.blockchain.networkName
    };

    this.contracts.set(contractId, contract);
    this.contractStorage.set(contractId, initialData);

    return contract;
  }

  executeContract(contractId, method, params, caller, value = 0) {
    const contract = this.contracts.get(contractId);
    if (!contract || contract.state !== 'active') {
      throw new Error('Contract not found or inactive');
    }

    try {
      // Simple contract execution environment
      const contractContext = {
        contractId,
        caller,
        value,
        timestamp: Date.now(),
        blockNumber: this.blockchain.chain.length,
        storage: this.contractStorage.get(contractId) || {},
        balance: contract.balance,
        
        // Contract functions
        transfer: (to, amount) => {
          if (contract.balance < amount) {
            throw new Error('Insufficient contract balance');
          }
          
          const tx = this.blockchain.createNewTransaction(amount, `CONTRACT:${contractId}`, to);
          this.blockchain.addTransactionToPendingTransactions(tx);
          contract.balance -= amount;
          return tx.transactionId;
        },
        
        emit: (eventName, data) => {
          this.contractEvents.push({
            contract: contractId,
            event: eventName,
            data,
            timestamp: Date.now(),
            block: this.blockchain.chain.length
          });
        },
        
        require: (condition, message) => {
          if (!condition) {
            throw new Error(message || 'Contract requirement failed');
          }
        }
      };

      // Execute contract method
      const result = this.executeContractMethod(contract.code, method, params, contractContext);
      
      // Update contract storage
      this.contractStorage.set(contractId, contractContext.storage);
      contract.balance = contractContext.balance;

      return {
        success: true,
        result,
        gasUsed: this.calculateGasUsed(method, params),
        events: this.contractEvents.filter(e => e.contract === contractId)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  executeContractMethod(contractCode, method, params, context) {
    // Simple contract method execution
    // In a real implementation, this would use a proper VM
    try {
      const contractFunction = new Function('context', 'method', 'params', `
        with(context) {
          ${contractCode}
          if (typeof ${method} === 'function') {
            return ${method}(...params);
          } else {
            throw new Error('Method not found: ${method}');
          }
        }
      `);
      
      return contractFunction(context, method, params);
    } catch (error) {
      throw new Error(`Contract execution failed: ${error.message}`);
    }
  }

  calculateGasUsed(method, params) {
    // Simple gas calculation
    const baseGas = 21000;
    const methodGas = method.length * 100;
    const paramsGas = JSON.stringify(params).length * 10;
    return baseGas + methodGas + paramsGas;
  }

  getContract(contractId) {
    const contract = this.contracts.get(contractId);
    if (!contract) return null;

    return {
      ...contract,
      storage: this.contractStorage.get(contractId),
      events: this.contractEvents.filter(e => e.contract === contractId)
    };
  }

  getContractEvents(contractId, eventName = null) {
    let events = this.contractEvents.filter(e => e.contract === contractId);
    if (eventName) {
      events = events.filter(e => e.event === eventName);
    }
    return events;
  }

  getTemplates() {
    return {
      token: `
        let totalSupply = storage.totalSupply || 1000000;
        let balances = storage.balances || {};
        
        function mint(to, amount) {
          require(caller === storage.owner, 'Only owner can mint');
          balances[to] = (balances[to] || 0) + amount;
          totalSupply += amount;
          emit('Transfer', { from: 'MINT', to, amount });
          return true;
        }
        
        function transfer(to, amount) {
          require(balances[caller] >= amount, 'Insufficient balance');
          balances[caller] -= amount;
          balances[to] = (balances[to] || 0) + amount;
          emit('Transfer', { from: caller, to, amount });
          return true;
        }
        
        function balanceOf(address) {
          return balances[address] || 0;
        }
        
        // Update storage
        storage.totalSupply = totalSupply;
        storage.balances = balances;
      `,
      
      lottery: `
        let tickets = storage.tickets || [];
        let prize = storage.prize || 0;
        let ticketPrice = storage.ticketPrice || 10;
        
        function buyTicket() {
          require(value >= ticketPrice, 'Insufficient payment');
          tickets.push(caller);
          prize += value;
          emit('TicketPurchased', { buyer: caller, ticketNumber: tickets.length });
          return tickets.length;
        }
        
        function drawWinner() {
          require(caller === storage.owner, 'Only owner can draw');
          require(tickets.length > 0, 'No tickets sold');
          
          const winnerIndex = Math.floor(Math.random() * tickets.length);
          const winner = tickets[winnerIndex];
          
          transfer(winner, prize);
          emit('WinnerDrawn', { winner, prize });
          
          // Reset lottery
          tickets = [];
          prize = 0;
          return winner;
        }
        
        function getTicketCount() {
          return tickets.length;
        }
        
        function getPrize() {
          return prize;
        }
        
        // Update storage
        storage.tickets = tickets;
        storage.prize = prize;
      `
    };
  }
}
