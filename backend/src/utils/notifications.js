const pool = require('./db');
const redis = require('./redis');

/**
 * Send a notification to an admin/owner
 * @param {Object} options - Notification options
 * @param {number} options.ownerId - ID of the admin/owner to notify
 * @param {string} options.type - Notification type ('payment_received', 'payment_failed', etc.)
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification message
 * @param {Object} [options.data] - Additional data to attach (JSON)
 */
async function sendNotification({ ownerId, type, title, message, data }) {
    const client = await pool.connect();
    try {
        // First, check admin's notification preferences
        const prefRes = await client.query(
            'SELECT notify_on_payment, notify_channel FROM admin WHERE id = $1',
            [ownerId]
        );
        if (prefRes.rows.length === 0) {
            console.error('Admin not found for notification');
            return;
        }

        const prefs = prefRes.rows[0];

        // Only create in-app notification if enabled (and always store in DB for history)
        const insertRes = await client.query(
            `INSERT INTO admin_notifications 
                (owner_id, type, title, message, data) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING *`,
            [ownerId, type, title, message, data || null]
        );

        const notification = insertRes.rows[0];

        // Publish to Redis for real-time updates
        try {
            await redis.publish(`notifications:${ownerId}`, JSON.stringify({
                type: 'new_notification',
                data: notification
            }));
        } catch (redisErr) {
            console.error('Redis publish error (non-fatal):', redisErr.message);
        }

        // TODO: Add SMS/Email sending here if notify_channel is set to those
        if (prefs.notify_channel === 'sms' || prefs.notify_channel === 'all') {
            // Implement SMS sending here
        }
        if (prefs.notify_channel === 'email' || prefs.notify_channel === 'all') {
            // Implement email sending here
        }

        return notification;
    } catch (err) {
        console.error('Notification error:', err);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    sendNotification
};
