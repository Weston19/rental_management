/**
 * RBAC middleware factory.
 *
 * Role hierarchy:
 *   owner   – full access (create, read, update, delete everything)
 *   manager – create + read + update; cannot delete payments, financial summaries,
 *             or manage other admin accounts
 *   viewer  – read-only; all mutating routes (POST/PUT/DELETE) are blocked
 *
 * Usage:
 *   router.delete('/:id', auth, requireRole('owner', 'manager'), handler)
 *   router.post('/',      auth, requireRole('owner', 'manager'), handler)
 *   router.get('/',       auth, requireRole('owner', 'manager', 'viewer'), handler)
 *
 * Convenience shorthands are exported as well:
 *   requireOwner    – only owner
 *   requireManager  – owner + manager
 *   requireAny      – owner + manager + viewer (all authenticated admins)
 */

const ROLE_RANK = { owner: 3, manager: 2, viewer: 1 };

/**
 * Returns middleware that allows only the listed roles.
 * @param {...string} allowedRoles
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.role) {
            return res.status(401).json({ error: 'Not authenticated.' });
        }
        if (!allowedRoles.includes(req.role)) {
            return res.status(403).json({
                error: `Forbidden. Requires one of: ${allowedRoles.join(', ')}. Your role: ${req.role}.`
            });
        }
        next();
    };
}

/**
 * Blocks viewer role from any mutating HTTP method (POST, PUT, PATCH, DELETE).
 * Use this on entire routers so you don't have to guard every individual route.
 */
function blockViewerWrites(req, res, next) {
    const mutateMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (req.role === 'viewer' && mutateMethods.includes(req.method)) {
        return res.status(403).json({ error: 'Viewers have read-only access.' });
    }
    next();
}

// Convenience shorthands
const requireOwner   = requireRole('owner');
const requireManager = requireRole('owner', 'manager');
const requireAny     = requireRole('owner', 'manager', 'viewer');

module.exports = { requireRole, blockViewerWrites, requireOwner, requireManager, requireAny };
