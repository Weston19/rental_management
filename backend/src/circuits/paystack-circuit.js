
const CircuitBreaker = require('opossum');
const axios = require('axios');

// ========== PAYSTACK CONFIGURATION ==========
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const BASE_URL = 'https://api.paystack.co';

// ========== CIRCUIT BREAKER OPTIONS ==========
const circuitOptions = {
    timeout: 15000, // 15 seconds timeout
    errorThresholdPercentage: 50, // Open when 50% of requests fail
    volumeThreshold: 5, // Start checking after 5 requests
    resetTimeout: 60000, // Try to close the circuit after 1 minute
    rollingCountTimeout: 30000, // Keep track of errors for 30 seconds
    rollingCountBuckets: 10
};

// ========== MAKE PAYSTACK API REQUEST ==========
async function makePaystackRequest(method, endpoint, data = null) {
    if (!PAYSTACK_SECRET_KEY) {
        throw new Error('PAYSTACK_SECRET_KEY environment variable is not set');
    }

    const config = {
        method: method,
        url: `${BASE_URL}${endpoint}`,
        headers: {
            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: 12000
    };

    if (data) {
        config.data = data;
    }

    const response = await axios(config);
    return response.data;
}

// ========== RESOLVE BANK ACCOUNT ==========
async function resolveBankAccount(accountNumber, bankCode) {
    return await makePaystackRequest('GET', `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
}

// ========== LIST BANKS ==========
async function listBanks() {
    return await makePaystackRequest('GET', '/bank');
}

// ========== CREATE SUBACCOUNT ==========
async function createSubaccount(businessName, settlementBank, accountNumber, percentageCharge = 100) {
    return await makePaystackRequest('POST', '/subaccount', {
        business_name: businessName,
        settlement_bank: settlementBank,
        account_number: accountNumber,
        percentage_charge: percentageCharge
    });
}

// ========== INITIALIZE TRANSACTION ==========
async function initializeTransaction(email, amount, reference, subaccountCode, bearer = 'subaccount', metadata = {}) {
    return await makePaystackRequest('POST', '/transaction/initialize', {
        email: email,
        amount: Math.round(amount * 100), // Convert to kobo
        reference: reference,
        subaccount: subaccountCode,
        bearer: bearer,
        metadata: metadata
    });
}

// ========== VERIFY TRANSACTION ==========
async function verifyTransaction(reference) {
    return await makePaystackRequest('GET', `/transaction/verify/${reference}`);
}

// ========== CREATE CIRCUIT BREAKERS ==========
const resolveBankCircuit = new CircuitBreaker(resolveBankAccount, circuitOptions);
const listBanksCircuit = new CircuitBreaker(listBanks, circuitOptions);
const createSubaccountCircuit = new CircuitBreaker(createSubaccount, circuitOptions);
const initializeTransactionCircuit = new CircuitBreaker(initializeTransaction, circuitOptions);
const verifyTransactionCircuit = new CircuitBreaker(verifyTransaction, circuitOptions);

// ========== CIRCUIT EVENT LISTENERS ==========
function setupCircuitListeners(circuit, name) {
    circuit.on('open', () => {
        console.log(`🔴 Paystack ${name} circuit OPEN - service unavailable`);
    });
    
    circuit.on('halfOpen', () => {
        console.log(`🟡 Paystack ${name} circuit HALF-OPEN - testing recovery`);
    });
    
    circuit.on('close', () => {
        console.log(`🟢 Paystack ${name} circuit CLOSED - service recovered`);
    });
    
    circuit.on('failure', (error) => {
        console.log(`❌ Paystack ${name} circuit - request failed:`, error.message);
    });
}

setupCircuitListeners(resolveBankCircuit, 'Resolve Bank');
setupCircuitListeners(listBanksCircuit, 'List Banks');
setupCircuitListeners(createSubaccountCircuit, 'Create Subaccount');
setupCircuitListeners(initializeTransactionCircuit, 'Initialize Transaction');
setupCircuitListeners(verifyTransactionCircuit, 'Verify Transaction');

// ========== EXPORT ==========
module.exports = {
    resolveBankCircuit,
    listBanksCircuit,
    createSubaccountCircuit,
    initializeTransactionCircuit,
    verifyTransactionCircuit,
    
    // Helper to check circuit state
    isAnyCircuitOpen: () => {
        return resolveBankCircuit.opened ||
               listBanksCircuit.opened ||
               createSubaccountCircuit.opened ||
               initializeTransactionCircuit.opened ||
               verifyTransactionCircuit.opened;
    }
};
