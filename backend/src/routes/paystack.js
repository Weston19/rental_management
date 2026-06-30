
const express = require('express');
const pool = require('../utils/db');
const redis = require('../utils/redis');
const auth = require('../middleware/auth');
const crypto = require('crypto');
const { 
    resolveBankCircuit, 
    listBanksCircuit, 
    createSubaccountCircuit, 
    initializeTransactionCircuit, 
    verifyTransactionCircuit 
} = require('../circuits/paystack-circuit');
const { queuePaystackWebhook } = require('../jobs/qstash-client');

const router = express.Router();
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const APP_BASE_URL = process.env.BASE_URL || process.env.APP_BASE_URL;

// Helper to normalize account name for comparison
function normalizeAccountName(name) {
    if (!name) return '';
    return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

// Helper to check name match (allow reasonable variations)
function isNameMatch(resolvedName, providedName) {
    if (!resolvedName || !providedName) return false;
    
    const normalizedResolved = normalizeAccountName(resolvedName);
    const normalizedProvided = normalizeAccountName(providedName);
    
    // Exact match
    if (normalizedResolved === normalizedProvided) return true;
    
    // Check if one is substring of the other (handles middle initials etc.)
    if (normalizedResolved.includes(normalizedProvided) || normalizedProvided.includes(normalizedResolved)) {
        return true;
    }
    
    return false;
}

// =============================================================
// 1. RESOLVE BANK ACCOUNT
// =============================================================
router.post('/resolve-bank', auth, async (req, res) => {
    try {
        const { account_number, bank_code } = req.body;

        if (!account_number || !bank_code) {
            return res.status(400).json({ 
                success: false, 
                error: 'Account number and bank code are required' 
            });
        }

        const result = await resolveBankCircuit.fire(account_number, bank_code);

        res.json({ 
            success: true, 
            data: result.data 
        });
    } catch (error) {
        console.error('❌ Resolve bank account error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.response?.data || error.message 
        });
    }
});

// =============================================================
// 2. LIST BANKS
// =============================================================
router.get('/banks', auth, async (req, res) => {
    try {
        const result = await listBanksCircuit.fire();
        res.json({ 
            success: true, 
            data: result.data 
        });
    } catch (error) {
        console.error('❌ List banks error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.response?.data || error.message 
        });
    }
});

// =============================================================
// 3. CREATE SUBACCOUNT (ONBOARD AGENCY) - WITH NAME MATCH CHECK
// =============================================================
router.post('/create-subaccount', auth, async (req, res) => {
    try {
        const { account_number, bank_code, business_name, percentage_charge = 100, account_name: provided_account_name } = req.body;

        // First resolve the bank account
        const resolveResult = await resolveBankCircuit.fire(account_number, bank_code);
        const resolved_account_name = resolveResult.data.account_name;

        // Check if account name matches what was provided
        if (provided_account_name && !isNameMatch(resolved_account_name, provided_account_name)) {
            return res.status(400).json({ 
                success: false, 
                error: `Account name mismatch. The account is registered as "${resolved_account_name}"`,
                resolved_name: resolved_account_name
            });
        }

        // Create Paystack subaccount
        const subaccountResult = await createSubaccountCircuit.fire(
            business_name || req.company_name || `Agency ${req.ownerId}`,
            bank_code,
            account_number,
            percentage_charge
        );

        const subaccount_code = subaccountResult.data.subaccount_code;

        // Update admin table with Paystack details
        await pool.query(
            `UPDATE admin 
             SET paystack_subaccount_code = $1,
                 paystack_bank_code = $2,
                 paystack_account_number = $3,
                 paystack_account_name = $4,
                 payment_configured = TRUE
             WHERE id = $5`,
            [subaccount_code, bank_code, account_number, resolved_account_name, req.ownerId]
        );

        res.json({ 
            success: true, 
            message: 'Subaccount created successfully',
            data: {
                subaccount_code,
                account_name: resolved_account_name
            }
        });
    } catch (error) {
        console.error('❌ Create subaccount error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.response?.data || error.message 
        });
    }
});

// =============================================================
// 4. INITIALIZE PAYMENT - WITH REFERENCE GENERATION & BEARER: SUBACCOUNT
// =============================================================
router.post('/initialize-payment', auth, async (req, res) => {
    try {
        const { tenant_id, amount, email, metadata = {} } = req.body;

        if (!tenant_id || !amount || amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Tenant ID and valid amount are required' 
            });
        }

        // Get tenant details and owner's subaccount
        const tenantResult = await pool.query(
            `SELECT t.email, t.first_name, t.last_name, 
                    a.paystack_subaccount_code, a.payment_configured
             FROM tenants t
             JOIN admin a ON t.owner_id = a.id
             WHERE t.id = $1 AND t.owner_id = $2`,
            [tenant_id, req.ownerId]
        );

        if (tenantResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Tenant not found' 
            });
        }

        const tenant = tenantResult.rows[0];
        const tenantEmail = email || tenant.email;

        if (!tenantEmail) {
            return res.status(400).json({ 
                success: false, 
                error: 'Tenant email is required' 
            });
        }

        if (!tenant.payment_configured || !tenant.paystack_subaccount_code) {
            return res.status(400).json({ 
                success: false, 
                error: 'Agency payment not configured. Please set up bank details first.' 
            });
        }

        // Generate unique reference (rent_{ownerId}_{tenantId}_{uuid})
        const cryptoRandom = crypto.randomUUID();
        const reference = `rent_${req.ownerId}_${tenant_id}_${cryptoRandom}`;

        // Initialize transaction with subaccount AND bearer: subaccount
        const result = await initializeTransactionCircuit.fire(
            tenantEmail,
            amount,
            reference,
            tenant.paystack_subaccount_code,
            'subaccount',
            {
                tenant_id: tenant_id,
                owner_id: req.ownerId,
                customer_name: `${tenant.first_name} ${tenant.last_name}`,
                ...metadata
            }
        );

        res.json({ 
            success: true, 
            message: 'Payment initialized successfully',
            data: {
                authorization_url: result.data.authorization_url,
                access_code: result.data.access_code,
                reference: reference
            }
        });
    } catch (error) {
        console.error('❌ Initialize payment error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.response?.data || error.message 
        });
    }
});

// =============================================================
// 5. VERIFY TRANSACTION (MANUAL VERIFICATION)
// =============================================================
router.get('/verify/:reference', auth, async (req, res) => {
    try {
        const reference = req.params.reference;
        const result = await verifyTransactionCircuit.fire(reference);

        res.json({ 
            success: true, 
            data: result.data 
        });
    } catch (error) {
        console.error('❌ Verify transaction error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.response?.data || error.message 
        });
    }
});

// =============================================================
// 6. PAYSTACK WEBHOOK ENDPOINT (SERVER-TO-SERVER) - WITH RAW BODY & SIGNATURE CHECK
// =============================================================
router.post('/webhook', async (req, res) => {
    try {
        const rawBody = req.body; // Now raw buffer because of express.raw()
        let event;
        
        try {
            event = JSON.parse(rawBody.toString());
        } catch (parseError) {
            console.error('❌ Invalid JSON in webhook');
            return res.sendStatus(400);
        }

        // Step 1: VERIFY SIGNATURE FIRST, BEFORE ANYTHING ELSE
        if (PAYSTACK_SECRET_KEY) {
            const hash = crypto
                .createHmac('sha512', PAYSTACK_SECRET_KEY)
                .update(rawBody) // Use RAW buffer, NOT stringified JSON!
                .digest('hex');

            if (hash !== req.headers['x-paystack-signature']) {
                console.log('❌ Invalid Paystack signature');
                return res.sendStatus(400);
            }
        } else {
            console.warn('⚠️ Paystack secret key not configured - skipping signature verification');
        }

        // Step 2: ACKNOWLEDGE IMMEDIATELY WITH 200 OK
        res.sendStatus(200);

        // Step 3: QUEUE PROCESSING ASYNCHRONOUSLY
        console.log('📥 Received Paystack webhook:', event.event);
        await queuePaystackWebhook(event);

    } catch (error) {
        console.error('❌ Paystack webhook error:', error);
        // Still send 200 OK even if processing fails
        res.sendStatus(200);
    }
});

// =============================================================
// 7. PAYMENT CALLBACK URL (BROWSER REDIRECT)
// =============================================================
router.get('/callback', async (req, res) => {
    try {
        const { reference } = req.query;
        res.json({ 
            success: true, 
            reference: reference,
            message: 'Payment received. Processing in background.' 
        });
    } catch (error) {
        console.error('❌ Paystack callback error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error processing payment' 
        });
    }
});

module.exports = router;
