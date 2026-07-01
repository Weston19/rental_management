const redis = require('./redis');

/**
 * Bulk delete cache keys by pattern
 * @param {string} pattern - Redis key pattern (e.g., "all_properties:*")
 * @returns {Promise<number>} Number of keys deleted
 */
async function deleteKeysByPattern(pattern) {
    try {
        let cursor = '0';
        let totalDeleted = 0;
        
        do {
            const reply = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = reply[0];
            const keys = reply[1];
            
            if (keys.length > 0) {
                const deleted = await redis.del(keys);
                totalDeleted += deleted;
            }
        } while (cursor !== '0');
        
        return totalDeleted;
    } catch (err) {
        console.error('Cache pattern delete error:', err.message);
        return 0;
    }
}

/**
 * Invalidate all property-related cache for an owner
 * @param {number} ownerId
 */
async function invalidatePropertyCache(ownerId) {
    try {
        await Promise.all([
            deleteKeysByPattern(`all_properties:${ownerId}`),
            deleteKeysByPattern(`property:${ownerId}:*`),
            deleteKeysByPattern(`all_rooms:${ownerId}`),
            deleteKeysByPattern(`rooms_by_property:${ownerId}:*`),
            deleteKeysByPattern(`available_rooms:${ownerId}:*`)
        ]);
    } catch (err) {
        console.error('Property cache invalidation error:', err.message);
    }
}

/**
 * Invalidate all tenant-related cache for an owner
 * @param {number} ownerId
 */
async function invalidateTenantCache(ownerId) {
    try {
        await Promise.all([
            deleteKeysByPattern(`all_tenants:${ownerId}`),
            deleteKeysByPattern(`active_tenants:${ownerId}`),
            deleteKeysByPattern(`tenant:${ownerId}:*`)
        ]);
    } catch (err) {
        console.error('Tenant cache invalidation error:', err.message);
    }
}

/**
 * Invalidate all payment-related cache for an owner
 * @param {number} ownerId
 */
async function invalidatePaymentCache(ownerId) {
    try {
        await Promise.all([
            deleteKeysByPattern(`all_payments:${ownerId}`),
            deleteKeysByPattern(`unassigned_payments:${ownerId}`),
            deleteKeysByPattern(`financial_summary:${ownerId}`)
        ]);
    } catch (err) {
        console.error('Payment cache invalidation error:', err.message);
    }
}

module.exports = {
    deleteKeysByPattern,
    invalidatePropertyCache,
    invalidateTenantCache,
    invalidatePaymentCache
};
