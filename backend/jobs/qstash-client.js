const { Client } = require('@upstash/qstash');

// Initialize QStash client
const qstashClient = new Client({
    token: process.env.QSTASH_TOKEN
});

/**
 * Queue an STK Push payment request
 */
async function queueStkPush(data) {
    try {
        const result = await qstashClient.publishJSON({
            url: `${process.env.BASE_URL || 'http://localhost:5016'}/api/qstash/process-stkpush`,
            body: data,
            retries: 3, // Retry up to 3 times
            delay: 0, // Process immediately
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
 * Queue M-Pesa callback processing
 */
async function queueCallbackProcessing(data) {
    try {
        const result = await qstashClient.publishJSON({
            url: `${process.env.BASE_URL || 'http://localhost:5016'}/api/qstash/process-callback`,
            body: data,
            retries: 5, // More retries for callbacks
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
 * Queue monthly bill generation
 */
async function queueMonthlyBills() {
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

module.exports = {
    qstashClient,
    queueStkPush,
    queueCallbackProcessing,
    queueMonthlyBills
};
