const express = require('express');
const pool = require('../utils/db');
const redis = require('../utils/redis');
const { stkPushCircuit, stkQueryCircuit } = require('../circuits/mpesa-circuit');
const router = express.Router();

// ── QStash signature guard ────────────────────────────────────────────────────
// These endpoints are called by QStash (a server-to-server job scheduler).
// They must NOT be callable by browsers or tenants.
// Verify using a shared secret stored in env: QSTASH_SECRET
function verifyQStashRequest(req, res, next) {
    const secret = process.env.QSTASH_SECRET;
    if (!secret) {
        // No secret configured — block all access in production, warn in dev
        if (process.env.NODE_ENV === 'production') {
            return res.status(403).json({ error: 'QStash secret not configured.' });
        }
        return next(); // allow in dev for testing
    }
    const provided = req.header('x-qstash-secret') || req.header('authorization')?.replace('Bearer ', '');
    if (provided !== secret) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    next();
}

router.use(verifyQStashRequest);
// ─────────────────────────────────────────────────────────────────────────────

// ========== M-PESA CONFIGURATION (same as mpesa.js) ==========
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE = process.env.MPESA_SHORTCODE;
const PASSKEY = process.env.MPESA_PASSKEY;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL;
const ENVIRONMENT = process.env.MPESA_ENVIRONMENT || 'sandbox';
const BASE_URL = ENVIRONMENT === 'sandbox' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';

// ========== HELPER: Detect Payment Type ==========
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

// ========== HELPER: Apply Payment to Bills ==========
async function applyPaymentToBills(tenantId, amount, transactionId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const bills = await client.query(
            `SELECT id, total_bill, total_paid FROM bills WHERE tenant_id = $1 AND total_bill > total_paid ORDER BY bill_month ASC FOR UPDATE`,
            [tenantId]
        );
        
        let remainingAmount = amount;
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
                remainingAmount -= paymentToApply;
            }
        }
        
        await client.query(
            `UPDATE tenants SET balance = (SELECT COALESCE(SUM(total_bill - total_paid), 0) FROM bills WHERE tenant_id = $1) WHERE id = $1`,
            [tenantId]
        );
        
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// ========== JOB 1: Process STK Push ==========
router.post('/process-stkpush', async (req, res) => {
    console.log('🔄 Processing queued STK Push:', req.body);
    const { phoneNumber, amount, accountReference, transactionDesc, tenantId } = req.body;
    
    try {
        // Call STK Push via circuit breaker
        const result = await stkPushCircuit.fire(
            phoneNumber, 
            amount, 
            accountReference, 
            transactionDesc
        );
        
        // Store the checkout request ID for tracking
        if (result.CheckoutRequestID) {
            await pool.query(
                `INSERT INTO payment_requests (tenant_id, checkout_request_id, amount, phone_number, status, created_at)
                 VALUES ($1, $2, $3, $4, 'pending', NOW())`,
                [tenantId, result.CheckoutRequestID, amount, phoneNumber]
            );
        }
        
        console.log('✅ STK Push processed successfully:', result);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('❌ Queued STK Push failed:', error);
        
        // Check if circuit is open
        if (error.message.includes('breaker is open')) {
            console.log('🔴 Circuit is open - cannot process payment');
        }
        
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== JOB 2: Process M-Pesa Callback ==========
router.post('/process-callback', async (req, res) => {
    console.log('🔄 Processing queued callback');
    const data = req.body;
    
    try {
        const result = data.Body?.stkCallback;
        if (!result) {
            return res.json({ success: false, error: 'Invalid callback format' });
        }
        
        const checkoutRequestID = result.CheckoutRequestID;
        const resultCode = result.ResultCode;
        const resultDesc = result.ResultDesc;
        
        // Check for duplicate transaction
        const existing = await pool.query(
            'SELECT id FROM payments WHERE transaction_id = $1',
            [checkoutRequestID]
        );
        
        if (existing.rows.length > 0) {
            console.log('⚠️ Duplicate transaction');
            return res.json({ success: true, duplicate: true });
        }
        
        // Update payment request status
        await pool.query(
            `UPDATE payment_requests 
             SET status = $1, result_code = $2, result_desc = $3, updated_at = NOW() 
             WHERE checkout_request_id = $4`,
            [resultCode === 0 ? 'completed' : 'failed', resultCode, resultDesc, checkoutRequestID]
        );
        
        if (resultCode === 0) {
            const callbackMetadata = result.CallbackMetadata?.Item || [];
            const amount = callbackMetadata.find(item => item.Name === 'Amount')?.Value;
            const mpesaReceipt = callbackMetadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
            const phoneNumber = callbackMetadata.find(item => item.Name === 'PhoneNumber')?.Value;
            const accountReference = callbackMetadata.find(item => item.Name === 'AccountReference')?.Value;
            
            const { payment_type, house_no, isCombined } = detectPaymentType(accountReference);
            
            // Find tenant
            const tenant = await pool.query(
                `SELECT t.id, t.first_name, t.last_name, t.phone
                 FROM tenants t JOIN rooms r ON t.room_id = r.id 
                 WHERE r.house_no = $1 AND t.is_deleted = FALSE`,
                [house_no]
            );
            
            if (tenant.rows.length === 0) {
                await pool.query(
                    `INSERT INTO unassigned_payments (account_number, amount, transaction_id, phone_number, payment_date)
                     VALUES ($1, $2, $3, $4, NOW())`,
                    [accountReference, amount, mpesaReceipt, phoneNumber]
                );
            } else {
                const tenantId = tenant.rows[0].id;
                
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
                        `UPDATE tenants SET deposit_paid = deposit_paid + $1, deposit_balance = deposit_balance - $1 WHERE id = $2`,
                        [amount, tenantId]
                    );
                }
            }
        }
        
        console.log('✅ Callback processed successfully');
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Queued callback processing failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== JOB 3: Generate Monthly Bills ==========
router.post('/generate-bills', async (req, res) => {
    console.log('🔄 Generating monthly bills');
    
    try {
        const now = new Date();
        const billMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // Get all active tenants with rooms
        const tenants = await pool.query(`
            SELECT t.id, t.property_id, t.room_id, r.rent
            FROM tenants t
            JOIN rooms r ON t.room_id = r.id
            WHERE t.is_deleted = FALSE AND r.status = 'occupied'
        `);
        
        let created = 0;
        let skipped = 0;
        
        for (const tenant of tenants.rows) {
            // Check if bill already exists
            const existing = await pool.query(
                `SELECT id FROM bills WHERE tenant_id = $1 AND bill_month = $2`,
                [tenant.id, billMonth]
            );
            
            if (existing.rows.length > 0) {
                skipped++;
                continue;
            }
            
            // Create the bill
            await pool.query(
                `INSERT INTO bills (tenant_id, property_id, room_id, bill_month, total_bill, status)
                 VALUES ($1, $2, $3, $4, $5, 'not_paid')`,
                [tenant.id, tenant.property_id, tenant.room_id, billMonth, tenant.rent]
            );
            
            // Add bill item
            const billResult = await pool.query(
                `SELECT id FROM bills WHERE tenant_id = $1 AND bill_month = $2`,
                [tenant.id, billMonth]
            );
            
            await pool.query(
                `INSERT INTO bill_items (bill_id, item_name, amount)
                 VALUES ($1, 'Rent', $2)`,
                [billResult.rows[0].id, tenant.rent]
            );
            
            created++;
        }
        
        console.log(`✅ Monthly bills generated: ${created} created, ${skipped} skipped`);
        res.json({ success: true, created, skipped });
    } catch (error) {
        console.error('❌ Bill generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== JOB 4: Process Paystack Webhook ==========
async function applyPaymentToBillsPaystack(tenantId, amount, transactionId, client) {
    const bills = await client.query(
        `SELECT id, total_bill, total_paid FROM bills WHERE tenant_id = $1 AND total_bill > total_paid ORDER BY bill_month ASC FOR UPDATE`,
        [tenantId]
    );
    
    let remainingAmount = amount;
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
            remainingAmount -= paymentToApply;
        }
    }
    
    await client.query(
        `UPDATE tenants SET balance = (SELECT COALESCE(SUM(total_bill - total_paid), 0) FROM bills WHERE tenant_id = $1) WHERE id = $1`,
        [tenantId]
    );
}

router.post('/process-paystack-webhook', async (req, res) => {
    console.log('🔄 Processing Paystack webhook');
    const event = req.body;
    
    try {
        // Step 1: IDEMPOTENCY CHECK - use Redis to prevent duplicate processing
        const idempotencyKey = `paystack:processed:${event.id || event.data?.reference}`;
        const alreadyProcessed = await redis.get(idempotencyKey);
        
        if (alreadyProcessed) {
            console.log('⚠️ Paystack webhook already processed:', idempotencyKey);
            return res.json({ success: true, duplicate: true });
        }

        // Step 2: Handle specific events
        if (event.event === 'charge.success') {
            const { reference, amount, metadata, customer } = event.data;
            
            // Parse reference: rent_{ownerId}_{tenantId}_{timestamp}
            const referenceParts = reference.split('_');
            let ownerId, tenantId;
            
            if (referenceParts.length >= 3 && referenceParts[0] === 'rent') {
                ownerId = parseInt(referenceParts[1]);
                tenantId = parseInt(referenceParts[2]);
            } else if (metadata?.owner_id && metadata?.tenant_id) {
                ownerId = metadata.owner_id;
                tenantId = metadata.tenant_id;
            } else {
                console.log('❌ Could not extract owner/tenant from Paystack webhook');
                await redis.setex(idempotencyKey, 86400, 'true'); // mark as processed
                return res.json({ success: true });
            }

            // Convert from kobo to NGN/KES (divide by 100)
            const amountNaira = amount / 100;

            // Use transaction to ensure atomicity
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Insert payment
                await client.query(
                    `INSERT INTO payments (tenant_id, amount, payment_type, transaction_id, source, payment_date, owner_id)
                     VALUES ($1, $2, 'rent', $3, 'paystack', NOW(), $4)`,
                    [tenantId, amountNaira, reference, ownerId]
                );

                // Apply payment to bills
                await applyPaymentToBillsPaystack(tenantId, amountNaira, reference, client);

                await client.query('COMMIT');

                // Mark as processed in Redis with 24h TTL
                await redis.setex(idempotencyKey, 86400, 'true');

                console.log('✅ Paystack payment processed successfully:', reference);
                res.json({ success: true });
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } else {
            // Log other events but don't process
            console.log('📥 Ignoring Paystack event:', event.event);
            await redis.setex(idempotencyKey, 86400, 'true');
            res.json({ success: true });
        }

    } catch (error) {
        console.error('❌ Paystack webhook processing failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
