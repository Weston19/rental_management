const CircuitBreaker = require('opossum');
const axios = require('axios');
const pool = require('../db');

// ========== M-PESA CONFIGURATION ==========
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE = process.env.MPESA_SHORTCODE;
const PASSKEY = process.env.MPESA_PASSKEY;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL;
const ENVIRONMENT = process.env.MPESA_ENVIRONMENT || 'sandbox';

const BASE_URL = ENVIRONMENT === 'sandbox' 
    ? 'https://sandbox.safaricom.co.ke' 
    : 'https://api.safaricom.co.ke';

// ========== CIRCUIT BREAKER OPTIONS ==========
const circuitOptions = {
    timeout: 15000, // 15 seconds timeout
    errorThresholdPercentage: 50, // Open when 50% of requests fail
    volumeThreshold: 5, // Start checking after 5 requests
    resetTimeout: 60000, // Try to close the circuit after 1 minute
    rollingCountTimeout: 30000, // Keep track of errors for 30 seconds
    rollingCountBuckets: 10
};

// ========== GET ACCESS TOKEN ==========
async function getAccessToken() {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    
    const response = await axios.get(
        `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        {
            headers: {
                'Authorization': `Basic ${auth}`
            },
            timeout: 10000
        }
    );
    return response.data.access_token;
}

// ========== STK PUSH ==========
async function callStkPush(phoneNumber, amount, accountReference, transactionDesc) {
    // Check if M-Pesa credentials are configured
    if (!CONSUMER_KEY || !CONSUMER_SECRET || !SHORTCODE || !PASSKEY || !CALLBACK_URL) {
        throw new Error('M-Pesa credentials not configured. Please set MPESA_* environment variables.');
    }
    
    const token = await getAccessToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
    
    // Format phone number to 2547XXXXXXXX format
    let formattedPhone = phoneNumber.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) {
        formattedPhone = '254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('254')) {
        // Already correct format
    } else if (formattedPhone.startsWith('7')) {
        formattedPhone = '254' + formattedPhone;
    } else {
        throw new Error('Invalid phone number format. Please use Kenyan phone number.');
    }
    
    const payload = {
        BusinessShortCode: SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: SHORTCODE,
        PhoneNumber: formattedPhone,
        CallBackURL: CALLBACK_URL,
        AccountReference: accountReference || 'RENTPAY',
        TransactionDesc: transactionDesc || 'Rent Payment'
    };
    
    const response = await axios.post(
        `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
        payload,
        { 
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 12000
        }
    );
    
    return response.data;
}

// ========== STK QUERY ==========
async function callStkQuery(checkoutRequestId) {
    const token = await getAccessToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
    
    const response = await axios.post(
        `${BASE_URL}/mpesa/stkpushquery/v1/query`,
        {
            BusinessShortCode: SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestId
        },
        {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 10000
        }
    );
    
    return response.data;
}

// ========== CREATE CIRCUIT BREAKERS ==========
const stkPushCircuit = new CircuitBreaker(callStkPush, circuitOptions);
const stkQueryCircuit = new CircuitBreaker(callStkQuery, circuitOptions);
const tokenCircuit = new CircuitBreaker(getAccessToken, circuitOptions);

// ========== CIRCUIT EVENT LISTENERS ==========
function setupCircuitListeners(circuit, name) {
    circuit.on('open', () => {
        console.log(`🔴 ${name} circuit OPEN - service unavailable`);
        // Optional: Send alert to admin
    });
    
    circuit.on('halfOpen', () => {
        console.log(`🟡 ${name} circuit HALF-OPEN - testing recovery`);
    });
    
    circuit.on('close', () => {
        console.log(`🟢 ${name} circuit CLOSED - service recovered`);
    });
    
    circuit.on('fallback', (result) => {
        console.log(`⚠️ ${name} circuit - fallback executed`);
    });
    
    circuit.on('failure', (error) => {
        console.log(`❌ ${name} circuit - request failed:`, error.message);
    });
    
    circuit.on('success', () => {
        // Optional: Log success
    });
}

setupCircuitListeners(stkPushCircuit, 'STK Push');
setupCircuitListeners(stkQueryCircuit, 'STK Query');
setupCircuitListeners(tokenCircuit, 'Access Token');

// ========== EXPORT ==========
module.exports = {
    stkPushCircuit,
    stkQueryCircuit,
    tokenCircuit,
    
    // Helper to check circuit state
    isCircuitOpen: () => {
        return stkPushCircuit.opened || stkQueryCircuit.opened || tokenCircuit.opened;
    }
};
