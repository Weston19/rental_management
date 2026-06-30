let qstashClient;
let qstashAvailable = false;

// Initialize QStash client only if token is available
if (process.env.QSTASH_TOKEN) {
    const { Client } = require('@upstash/qstash');
    qstashClient = new Client({
        token: process.env.QSTASH_TOKEN
    });
    qstashAvailable = true;
    console.log('✅ QStash initialized');
} else {
    console.log('⚠️ QStash not configured (optional)');
}

/**
 * Queue an STK Push payment request (optional)
 */
async function queueStkPush(data) {
    if (!qstashAvailable) {
        console.log('⚠️ QStash not configured, skipping queue');
        return { success: true, message: 'QStash not configured' };
    }
    try {
        const result = await qstashClient.publishJSON({
            url: `${process.env.BASE_URL || 'http://localhost:5016'}/api/qstash/process-stkpush`,
            body: data,
            retries: 3,
            delay: 0,
            deduplicationId: `stkpush-${data.tenantId}-${Date.now()}`
        });
        
        console.log('📤 STK Push queued successfully:', result.messageId);
        return { success: true, messageId: result.messageId };
    } catch (error) {
        console.error('❌ Failed to queue STK Push:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Queue M-Pesa callback processing (optional)
 */
async function queueCallbackProcessing(data) {
    if (!qstashAvailable) {
        console.log('⚠️ QStash not configured, processing synchronously');
        return { success: true, message: 'QStash not configured' };
    }
    try {
        const result = await qstashClient.publishJSON({
            url: `${process.env.BASE_URL || 'http://localhost:5016'}/api/qstash/process-callback`,
            body: data,
            retries: 5,
            delay: 0,
            deduplicationId: `callback-${data.Body?.stkCallback?.CheckoutRequestID || Date.now()}`
        });
        
        console.log('📤 Callback processing queued:', result.messageId);
        return { success: true, messageId: result.messageId };
    } catch (error) {
        console.error('❌ Failed to queue callback:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Queue monthly bill generation (optional)
 */
async function queueMonthlyBills() {
    if (!qstashAvailable) {
        console.log('⚠️ QStash not configured, skipping queue');
        return { success: true, message: 'QStash not configured' };
    }
    try {
        const result = await qstashClient.publishJSON({
            url: `${process.env.BASE_URL || 'http://localhost:5016'}/api/qstash/generate-bills`,
            body: { timestamp: Date.now() },
            retries: 2,
            delay: 0
        });
        
        console.log('📤 Monthly bills generation queued:', result.messageId);
        return { success: true, messageId: result.messageId };
    } catch (error) {
        console.error('❌ Failed to queue bill generation:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Queue Paystack webhook processing (critical)
 */
async function queuePaystackWebhook(data) {
    if (!qstashAvailable) {
        console.log('⚠️ QStash not configured, skipping queue');
        return { success: true, message: 'QStash not configured' };
    }
    try {
        // Use Paystack event ID if available for deduplication
        const deduplicationId = data.id ? `paystack-${data.id}` : `paystack-${Date.now()}`;
        
        const result = await qstashClient.publishJSON({
            url: `${process.env.BASE_URL || 'http://localhost:5016'}/api/qstash/process-paystack-webhook`,
            body: data,
            retries: 5,
            delay: 0,
            deduplicationId: deduplicationId
        });
        
        console.log('📤 Paystack webhook processing queued:', result.messageId);
        return { success: true, messageId: result.messageId };
    } catch (error) {
        console.error('❌ Failed to queue Paystack webhook:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    qstashClient,
    queueStkPush,
    queueCallbackProcessing,
    queueMonthlyBills,
    queuePaystackWebhook,
    isQStashAvailable: () => qstashAvailable
};
