
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
async function listBanks(country = 'ke') {
    return await makePaystackRequest('GET', `/bank?country=${country}`);
}

// ========== INITIATE CHARGE (STK Push/Bank) ==========
async function initiateCharge(email, amount, reference, phone, channel, subaccountCode = null) {
    const payload = {
        email,
        amount: Math.round(amount * 100), // Convert to kobo
        reference,
        callback_url: `${process.env.APP_BASE_URL || process.env.BASE_URL}/api/paystack/callback`,
        channels: channel ? [channel] : ['mobile_money', 'card', 'bank'],
        metadata: {}
    };

    if (subaccountCode) {
        payload.subaccount = subaccountCode;
        payload.bearer = 'subaccount';
    }

    // For mobile money, add phone
    if (channel === 'mobile_money' && phone) {
        payload.metadata.phone = phone;
    }

    return await makePaystackRequest('POST', '/charge', payload);
}

// ========== SUBMIT PIN/OTP for charge ==========
async function submitChargePin(reference, pin) {
    return await makePaystackRequest('POST', '/charge/submit_pin', {
        reference,
        pin
    });
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

// ========== UPDATE SUBACCOUNT ==========
async function updateSubaccount(subaccountCode, businessName, settlementBank, accountNumber, percentageCharge = 100) {
    return await makePaystackRequest('PUT', `/subaccount/${subaccountCode}`, {
        business_name: businessName,
        settlement_bank: settlementBank,
        account_number: accountNumber,
        percentage_charge: percentageCharge
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
const updateSubaccountCircuit = new CircuitBreaker(updateSubaccount, circuitOptions);
const initializeTransactionCircuit = new CircuitBreaker(initializeTransaction, circuitOptions);
const verifyTransactionCircuit = new CircuitBreaker(verifyTransaction, circuitOptions);
const initiateChargeCircuit = new CircuitBreaker(initiateCharge, circuitOptions);
const submitChargePinCircuit = new CircuitBreaker(submitChargePin, circuitOptions);

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
setupCircuitListeners(updateSubaccountCircuit, 'Update Subaccount');
setupCircuitListeners(initializeTransactionCircuit, 'Initialize Transaction');
setupCircuitListeners(verifyTransactionCircuit, 'Verify Transaction');
setupCircuitListeners(initiateChargeCircuit, 'Initiate Charge');
setupCircuitListeners(submitChargePinCircuit, 'Submit Charge PIN');

// ========== EXPORT ==========
module.exports = {
    resolveBankCircuit,
    listBanksCircuit,
    createSubaccountCircuit,
    updateSubaccountCircuit,
    initializeTransactionCircuit,
    verifyTransactionCircuit,
    initiateChargeCircuit,
    submitChargePinCircuit,
    
    // Helper functions for easier usage
    resolveAccount: async ({ account_number, bank_code }) => {
        return await resolveBankCircuit.fire(account_number, bank_code);
    },
    listBanks: async (country = 'ke') => {
        return await listBanksCircuit.fire(country);
    },
    createSubaccount: async ({ business_name, settlement_bank, account_number, percentage_charge = 0 }) => {
        return await createSubaccountCircuit.fire(business_name, settlement_bank, account_number, percentage_charge);
    },
    updateSubaccount: async ({ subaccount_code, business_name, settlement_bank, account_number, percentage_charge = 0 }) => {
        return await updateSubaccountCircuit.fire(subaccount_code, business_name, settlement_bank, account_number, percentage_charge);
    },
    initializeTransaction: async ({ email, amount, reference, subaccount_code, bearer = 'subaccount', metadata = {} }) => {
        return await initializeTransactionCircuit.fire(email, amount, reference, subaccount_code, bearer, metadata);
    },
    verifyTransaction: async (reference) => {
        return await verifyTransactionCircuit.fire(reference);
    },
    initiateCharge: async ({ email, amount, reference, phone, channel, subaccount_code = null }) => {
        return await initiateChargeCircuit.fire(email, amount, reference, phone, channel, subaccount_code);
    },
    submitChargePin: async ({ reference, pin }) => {
        return await submitChargePinCircuit.fire(reference, pin);
    },
    
    // Helper to check circuit state
    isAnyCircuitOpen: () => {
        return resolveBankCircuit.opened ||
               listBanksCircuit.opened ||
               createSubaccountCircuit.opened ||
               updateSubaccountCircuit.opened ||
               initializeTransactionCircuit.opened ||
               verifyTransactionCircuit.opened ||
               initiateChargeCircuit.opened ||
               submitChargePinCircuit.opened;
    }
};
