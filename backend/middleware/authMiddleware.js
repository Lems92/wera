const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

// Tiny in-memory cache to avoid hammering the DB on every request:
// userId -> { banned, suspendedUntil, exp: <timestamp ms> }
const banCache = new Map();
const BAN_CACHE_TTL_MS = 60 * 1000;

// La colonne suspended_until arrive avec la migration modération. Tant
// qu'elle n'existe pas, on retombe sur is_banned seul sans casser l'auth.
let hasSuspendColumn = true;

async function getRestriction(userId) {
    const now = Date.now();
    const hit = banCache.get(userId);
    if (hit && hit.exp > now) return hit;

    const cols = hasSuspendColumn ? 'is_banned, suspended_until' : 'is_banned';
    let { data, error } = await supabase
        .from('users')
        .select(cols)
        .eq('id', userId)
        .single();

    if (error && hasSuspendColumn && /suspended_until/i.test(error.message || '')) {
        hasSuspendColumn = false;
        ({ data, error } = await supabase
            .from('users')
            .select('is_banned')
            .eq('id', userId)
            .single());
    }
    if (error) {
        console.warn('getRestriction() DB error:', error.message);
        return { banned: false, suspendedUntil: null, exp: 0 };
    }
    const entry = {
        banned: Boolean(data?.is_banned),
        suspendedUntil: data?.suspended_until ? Date.parse(data.suspended_until) : null,
        exp: now + BAN_CACHE_TTL_MS
    };
    banCache.set(userId, entry);
    return entry;
}

// Banni OU suspension en cours → accès refusé (utilisé aussi par le socket).
async function isBanned(userId) {
    const r = await getRestriction(userId);
    return r.banned || (r.suspendedUntil && r.suspendedUntil > Date.now());
}

function readToken(req) {
    // Prefer the HttpOnly cookie (browser flow). Fall back to the
    // Authorization header for native / programmatic clients.
    const cookieToken = req.cookies?.wera_token;
    if (cookieToken) return cookieToken;
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7) : null;
}

module.exports = async function auth(req, res, next) {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: 'Non autorisé' });

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Token invalide' });
    }

    if (!decoded?.id) return res.status(401).json({ error: 'Token invalide' });

    // Global kill-switch — any token issued before this Unix-seconds timestamp
    // is rejected. Lets ops invalidate every issued token at once after a
    // suspected key leak by setting JWT_VALID_AFTER=<now>.
    const validAfter = Number(process.env.JWT_VALID_AFTER || 0);
    if (validAfter && (decoded.iat || 0) < validAfter) {
        return res.status(401).json({ error: 'Token révoqué' });
    }

    const restriction = await getRestriction(decoded.id);
    if (restriction.banned) {
        return res.status(403).json({ error: 'Compte banni' });
    }
    if (restriction.suspendedUntil && restriction.suspendedUntil > Date.now()) {
        const until = new Date(restriction.suspendedUntil);
        return res.status(403).json({
            error: 'Compte suspendu jusqu\'au ' + until.toLocaleString('fr-FR', { timeZone: 'Indian/Antananarivo' })
        });
    }

    req.user = decoded;
    req.token = token;
    next();
};

module.exports.isBanned = isBanned;
module.exports.readToken = readToken;
// Invalide l'entrée de cache d'un utilisateur (après une sanction, pour
// qu'elle prenne effet tout de suite au lieu d'attendre l'expiration TTL).
module.exports.invalidateRestrictionCache = (userId) => banCache.delete(userId);
