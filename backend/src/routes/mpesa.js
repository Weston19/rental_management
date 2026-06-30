const express = require('express');
const axios = require('axios');
const bcrypt = require('bcrypt');
const pool = require('../utils/db');
const auth = require('../middleware/auth');
const { stkPushCircuit, stkQueryCircuit } = require('../circuits/mpesa-circuit');
const { queueCallbackProcessing } = require('../jobs/qstash-client');

const router = express.Router();

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

// ================================================================
// HELPER FUNCTIONS
// ================================================================

// Get Access Token
async function getAccessToken() {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    
    try {
        const response = await axios.get(
            `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
            {
                headers: {
                    'Authorization': `Basic ${auth}`
                }
            }
        );
        return response.data.access_token;
    } catch (error) {
        console.error('❌ Failed to get access token:', error.response?.data || error.message);
        throw error;
    }
}

// Detect Payment Type from Account Number
function detectPaymentType(accountNumber) {
    if (!accountNumber) return { payment_type: 'rent', house_no: '', isCombined: false };
    
    let payment_type = 'rent';
    let house_no = accountNumber;
    let isCombined = false;
    
    if (accountNumber.startsWith('RD')) {
        payment_type = 'combined';
        house_no = accountNumber.substring(2);
        isCombined = true;
    } else if (accountNumber.startsWith('D')) {
        payment_type = 'deposit';
        house_no = accountNumber.substring(1);
    } else if (accountNumber.startsWith('P')) {
        payment_type = 'penalty';
        house_no = accountNumber.substring(1);
    }
    
    return { payment_type, house_no, isCombined };
}

// Apply Payment to Bills
async function applyPaymentToBills(tenantId, amount, transactionId) {
    console.log(`🔄 Applying payment to bills for tenant ${tenantId}, Amount: ${amount}`);
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Get unpaid bills (oldest first) with row lock
        const bills = await client.query(
            `SELECT id, total_bill, total_paid 
             FROM bills 
             WHERE tenant_id = $1 AND total_bill > total_paid
             ORDER BY bill_month ASC
             FOR UPDATE`,
            [tenantId]
        );
        
        let remainingAmount = amount;
        let appliedToBills = 0;
        
        for (const bill of bills.rows) {
            if (remainingAmount <= 0) break;
            
            const billOwed = parseFloat(bill.total_bill) - parseFloat(bill.total_paid);
            const paymentToApply = Math.min(remainingAmount, billOwed);
            
            if (paymentToApply > 0) {
                const newTotalPaid = parseFloat(bill.total_paid) + paymentToApply;
                let newStatus = 'not_paid';
                if (newTotalPaid >= parseFloat(bill.total_bill)) newStatus = 'paid';
                else if (newTotalPaid > 0) newStatus = 'partially_paid';
                
                await client.query(
                    `UPDATE bills SET total_paid = $1, status = $2, updated_at = NOW() WHERE id = $3`,
                    [newTotalPaid, newStatus, bill.id]
                );
                
                console.log(`✅ Bill ${bill.id} updated: Paid ${paymentToApply}, Status: ${newStatus}`);
                remainingAmount -= paymentToApply;
                appliedToBills += paymentToApply;
            }
        }
        
        // Update tenant balance
        await client.query(
            `UPDATE tenants SET balance = (
                SELECT COALESCE(SUM(total_bill - total_paid), 0)
                FROM bills WHERE tenant_id = $1
            ) WHERE id = $1`,
            [tenantId]
        );
        
        await client.query('COMMIT');
        
        if (remainingAmount > 0) {
            console.log(`⚠️ Overpayment of ${remainingAmount} will be stored as credit`);
        }
        
        return { success: true, appliedToBills, overpayment: remainingAmount };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error applying payment:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Process Combined Payment (Deposit + Rent)
async function processCombinedPayment(tenantId, amount, transactionId, house_no) {
    console.log(`🔄 Processing combined payment for tenant ${tenantId}, Amount: ${amount}`);
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Get tenant deposit requirement
        const tenant = await client.query(
            `SELECT t.*, r.deposit 
             FROM tenants t
             JOIN rooms r ON t.room_id = r.id
             WHERE t.id = $1`,
            [tenantId]
        );
        
        if (tenant.rows.length === 0) {
            throw new Error('Tenant not found');
        }
        
        const depositRequired = parseFloat(tenant.rows[0].deposit) || 0;
        let remainingAmount = amount;
        let depositPaid = 0;
        let rentPaid = 0;
        
        // First: Pay deposit
        if (depositRequired > 0 && remainingAmount > 0) {
            depositPaid = Math.min(remainingAmount, depositRequired);
            remainingAmount -= depositPaid;
            
            await client.query(
                `INSERT INTO payments (tenant_id, amount, payment_type, transaction_id, source, payment_date)
                 VALUES ($1, $2, 'deposit', $3, 'auto', NOW())`,
                [tenantId, depositPaid, transactionId + '_deposit']
            );
            console.log(`✅ Deposit paid: ${depositPaid}`);
        }
        
        // Second: Remaining goes to rent
        if (remainingAmount > 0) {
            rentPaid = remainingAmount;
            await client.query(
                `INSERT INTO payments (tenant_id, amount, payment_type, transaction_id, source, payment_date)
                 VALUES ($1, $2, 'rent', $3, 'auto', NOW())`,
                [tenantId, rentPaid, transactionId + '_rent']
            );
            console.log(`✅ Rent paid: ${rentPaid}`);
            
            // Apply rent payment to bills
            await applyPaymentToBills(tenantId, rentPaid, transactionId);
        }
        
        await client.query('COMMIT');
        
        return { success: true, depositPaid, rentPaid };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Combined payment error:', error);
        throw error;
    } finally {
        client.release();
    }
}

// ================================================================
// M-PESA API ENDPOINTS
// ================================================================

// 1. STK Push (Lipa Na M-Pesa Online)
router.post('/stkpush', async (req, res) => {
    const { phone_number, amount, account_reference, transaction_desc } = req.body;
    
    console.log('📡 STK Push Request:', { phone_number, amount, account_reference });
    
    // Check if M-Pesa credentials are configured
    const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
    const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
    const SHORTCODE = process.env.MPESA_SHORTCODE;
    const PASSKEY = process.env.MPESA_PASSKEY;
    const CALLBACK_URL = process.env.MPESA_CALLBACK_URL;
    
    if (!CONSUMER_KEY || !CONSUMER_SECRET || !SHORTCODE || !PASSKEY || !CALLBACK_URL) {
        console.log('⚠️ M-Pesa credentials not configured - returning simulated response');
        const mockCheckoutId = 'SIM_' + Date.now();
        
        await pool.query(
            `INSERT INTO payment_requests (checkout_request_id, amount, phone_number, status, created_at)
             VALUES ($1, $2, $3, 'pending', NOW())`,
            [mockCheckoutId, amount, phone_number]
        );
        
        return res.json({
            success: true,
            data: {
                MerchantRequestID: 'SIM_MERCHANT_' + Date.now(),
                CheckoutRequestID: mockCheckoutId,
                ResponseCode: '0',
                ResponseDescription: 'Simulated STK Push - credentials not configured',
                CustomerMessage: 'This is a demo mode since M-Pesa is not configured'
            },
            message: 'Demo mode: STK Push simulated'
        });
    }
    
    try {
        // Validate
        if (!phone_number || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid phone number or amount' });
        }
        
        // Check if circuit is open first
        if (stkPushCircuit.opened) {
            return res.status(503).json({
                success: false,
                error: 'M-Pesa service temporarily unavailable',
                message: 'Please try again in 1 minute',
                circuitOpen: true
            });
        }
        
        console.log('🔄 Calling M-Pesa via circuit breaker...');
        const response = await stkPushCircuit.fire(
            phone_number,
            amount,
            account_reference,
            transaction_desc
        );
        
        console.log('✅ STK Push sent:', response);
        
        // Store checkout request ID for tracking
        if (response.CheckoutRequestID) {
            await pool.query(
                `INSERT INTO payment_requests (checkout_request_id, amount, phone_number, status, created_at)
                 VALUES ($1, $2, $3, 'pending', NOW())`,
                [response.CheckoutRequestID, amount, phone_number]
            );
        }
        
        res.json({
            success: true,
            data: response,
            message: 'STK Push sent to customer phone'
        });
    } catch (error) {
        console.error('❌ STK Push Error:', error.message);
        console.error('❌ STK Push Stack:', error.stack);
        
        if (error.message.includes('breaker is open')) {
            return res.status(503).json({
                success: false,
                error: 'M-Pesa service temporarily unavailable',
                message: 'Please try again in 1 minute',
                circuitOpen: true
            });
        }
        
        res.status(500).json({
            success: false,
            error: error.response?.data || error.message,
            details: error.response?.data || 'Unknown error'
        });
    }
});

// 2. STK Push Query Status
router.post('/stkquery', auth, async (req, res) => {
    const { checkout_request_id } = req.body;
    
    try {
        const token = await getAccessToken();
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
        
        const response = await axios.post(
            `${BASE_URL}/mpesa/stkpushquery/v1/query`,
            {
                BusinessShortCode: SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                CheckoutRequestID: checkout_request_id
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        
        res.json(response.data);
    } catch (error) {
        console.error('❌ STK Query Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data || error.message
        });
    }
});

// 3. M-Pesa Callback (Webhook)
router.post('/callback', async (req, res) => {
    console.log('📡 M-Pesa Callback Received');
    
    // Store raw callback for audit
    try {
        await pool.query(
            'INSERT INTO mpesa_callbacks (raw_data, processed) VALUES ($1, FALSE)',
            [req.body]
        );
    } catch (error) {
        console.error('❌ Failed to store callback:', error);
    }
    
    // Always respond to Safaricom immediately (CRITICAL - must respond within 5 seconds)
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
    
    // Check if QStash is available, if not process right away
    const { isQStashAvailable } = require('../jobs/qstash-client');
    if (isQStashAvailable()) {
        // Queue callback processing via QStash for reliability
        console.log('📤 Queuing callback processing via QStash...');
        await queueCallbackProcessing(req.body);
    } else {
        // Process synchronously since QStash not set up
        console.log('⚠️ Processing callback synchronously...');
        await processCallback(req.body);
    }
});

// 4. Process Callback
async function processCallback(data) {
    try {
        console.log('🔄 Processing callback...');
        const result = data.Body?.stkCallback;
        
        if (!result) {
            console.log('❌ Invalid callback format - missing stkCallback');
            console.log('📦 Received data structure:', Object.keys(data));
            if (data.TransactionType) {
                console.log('📦 This appears to be a C2B callback, not STK Push');
            }
            return;
        }
        
        const checkoutRequestID = result.CheckoutRequestID;
        const resultCode = result.ResultCode;
        const resultDesc = result.ResultDesc;
        
        console.log('📋 CheckoutRequestID:', checkoutRequestID);
        console.log('📋 ResultCode:', resultCode);
        console.log('📋 ResultDesc:', resultDesc);
        
        // Check for duplicate transaction
        const existing = await pool.query(
            'SELECT id FROM payments WHERE transaction_id = $1',
            [checkoutRequestID]
        );
        
        if (existing.rows.length > 0) {
            console.log('⚠️ Duplicate transaction ignored:', checkoutRequestID);
            return;
        }
        
        if (resultCode === 0) {
            const callbackMetadata = result.CallbackMetadata?.Item || [];
            const amount = callbackMetadata.find(item => item.Name === 'Amount')?.Value;
            const mpesaReceipt = callbackMetadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
            const phoneNumber = callbackMetadata.find(item => item.Name === 'PhoneNumber')?.Value;
            const accountReference = callbackMetadata.find(item => item.Name === 'AccountReference')?.Value;
            
            console.log('💰 Payment details:', { amount, mpesaReceipt, phoneNumber, accountReference });
            
            if (!amount || !mpesaReceipt) {
                console.log('❌ Missing payment details in callback');
                return;
            }
            
            const { payment_type, house_no, isCombined } = detectPaymentType(accountReference);
            console.log('🔍 Detected:', { payment_type, house_no, isCombined });
            
            const tenant = await pool.query(
                `SELECT t.id, t.first_name, t.last_name, t.phone
                 FROM tenants t 
                 JOIN rooms r ON t.room_id = r.id 
                 WHERE r.house_no = $1 AND t.is_deleted = FALSE`,
                [house_no]
            );
            
            if (tenant.rows.length === 0) {
                await pool.query(
                    `INSERT INTO unassigned_payments (account_number, amount, transaction_id, phone_number, payment_date)
                     VALUES ($1, $2, $3, $4, NOW())`,
                    [accountReference, amount, mpesaReceipt, phoneNumber]
                );
                console.log('⚠️ Unassigned payment:', accountReference);
                return;
            }
            
            const tenantId = tenant.rows[0].id;
            
            if (isCombined) {
                await processCombinedPayment(tenantId, amount, mpesaReceipt, house_no);
            } else {
                await pool.query(
                    `INSERT INTO payments (tenant_id, amount, payment_type, transaction_id, source, payment_date)
                     VALUES ($1, $2, $3, $4, 'auto', NOW())`,
                    [tenantId, amount, payment_type, mpesaReceipt]
                );
                if (payment_type === 'rent' || payment_type === 'penalty') {
                    await applyPaymentToBills(tenantId, amount, mpesaReceipt);
                }
                if (payment_type === 'deposit') {
                    await pool.query(
                        `UPDATE tenants SET deposit_paid = deposit_paid + $1, 
                         deposit_balance = deposit_balance - $1 
                         WHERE id = $2`,
                        [amount, tenantId]
                    );
                }
            }
            
            console.log('✅ Payment recorded:', { tenantId, amount, payment_type, mpesaReceipt });
            
            await pool.query(
                'UPDATE mpesa_callbacks SET processed = TRUE WHERE raw_data = $1',
                [data]
            );
            
        } else {
            console.log('❌ Payment failed:', resultDesc);
        }
    } catch (error) {
        console.error('❌ Callback processing error:', error);
        try {
            await pool.query(
                `INSERT INTO mpesa_webhook_queue (payload, attempts, status, error_message)
                 VALUES ($1, 0, 'pending', $2)`,
                [data, error.message]
            );
        } catch (dbError) {
            console.error('❌ Failed to store webhook:', dbError);
        }
    }
}

// 5. Unassigned Payments - Get List
router.get('/unassigned', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM unassigned_payments 
             WHERE assigned_to_tenant_id IS NULL
               AND (owner_id = $1 OR owner_id IS NULL)
             ORDER BY created_at DESC`,
            [req.ownerId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Get unassigned error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 6. Unassigned Payments - Assign to Tenant  (manager+ only)
router.post('/unassigned/assign/:id', auth, async (req, res) => {
    const { room_id, password } = req.body;
    const paymentId = req.params.id;

    // Viewers cannot assign payments
    if (req.role === 'viewer') {
        return res.status(403).json({ error: 'Viewers have read-only access.' });
    }

    try {
        // Verify admin password
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        // Find tenant for the room — must belong to this owner
        const room = await pool.query(
            `SELECT t.id as tenant_id, t.owner_id FROM rooms r
             JOIN properties p ON r.property_id = p.id
             JOIN tenants t ON r.id = t.room_id
             WHERE r.id = $1 AND p.owner_id = $2 AND t.is_deleted = FALSE`,
            [room_id, req.ownerId]
        );

        if (room.rows.length === 0) {
            return res.status(404).json({ error: 'No active tenant found for this room' });
        }

        // Get unassigned payment
        const payment = await pool.query('SELECT * FROM unassigned_payments WHERE id = $1', [paymentId]);
        if (payment.rows.length === 0) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        const tenantId = room.rows[0].tenant_id;

        // Create payment record with owner_id
        await pool.query(
            `INSERT INTO payments (tenant_id, amount, payment_type, transaction_id, source, payment_date, owner_id)
             VALUES ($1, $2, 'rent', $3, 'auto', $4, $5)`,
            [tenantId, payment.rows[0].amount, payment.rows[0].transaction_id,
             payment.rows[0].payment_date, req.ownerId]
        );

        // Apply payment to bills
        await applyPaymentToBills(tenantId, payment.rows[0].amount, payment.rows[0].transaction_id);

        // Mark as assigned
        await pool.query(
            `UPDATE unassigned_payments
             SET assigned_to_tenant_id = $1, assigned_by = $2, assigned_at = NOW(), owner_id = $3
             WHERE id = $4`,
            [tenantId, req.adminId, req.ownerId, paymentId]
        );

        res.json({ message: 'Payment assigned successfully' });
    } catch (error) {
        console.error('❌ Assign payment error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 7. Simulate Payment (Testing)
router.post('/simulate', auth, async (req, res) => {
    const { account_number, amount } = req.body;
    
    try {
        // Simulate a payment callback
        const mockData = {
            Body: {
                stkCallback: {
                    CheckoutRequestID: 'SIM_' + Date.now(),
                    ResultCode: 0,
                    ResultDesc: 'Success',
                    CallbackMetadata: {
                        Item: [
                            { Name: 'Amount', Value: amount },
                            { Name: 'MpesaReceiptNumber', Value: 'SIM' + Date.now() },
                            { Name: 'PhoneNumber', Value: '254712345678' },
                            { Name: 'AccountReference', Value: account_number }
                        ]
                    }
                }
            }
        };
        
        // Process callback
        await processCallback(mockData);
        
        res.json({
            success: true,
            message: 'Simulated payment processed',
            data: mockData
        });
    } catch (error) {
        console.error('❌ Simulate error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});
// 8. Test Callback (Simulate Safaricom)
router.post('/test-callback', async (req, res) => {
    console.log('🧪 Test Callback Received');
    
    // Simulate a Safaricom callback
    const mockCallback = {
        Body: {
            stkCallback: {
                CheckoutRequestID: 'TEST_' + Date.now(),
                ResultCode: 0,
                ResultDesc: 'Success',
                CallbackMetadata: {
                    Item: [
                        { Name: 'Amount', Value: 100 },
                        { Name: 'MpesaReceiptNumber', Value: 'TEST' + Date.now() },
                        { Name: 'PhoneNumber', Value: '254712345678' },
                        { Name: 'AccountReference', Value: 'MG004' }
                    ]
                }
            }
        }
    };
    
    console.log('🧪 Simulated callback:', JSON.stringify(mockCallback, null, 2));
    
    // Process the callback
    await processCallback(mockCallback);
    
    res.json({ 
        success: true, 
        message: 'Test callback processed',
        data: mockCallback
    });
});
module.exports = router;