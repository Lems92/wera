const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

// Tiny in-memory cache to avoid hammering the DB on every request:
// userId -> { banned: boolean, exp: <timestamp ms> }
const banCache = new Map();
const BAN_CACHE_TTL_MS = 60 * 1000;

async function isBanned(userId) {
    const now = Date.now();
    const hit = banCache.get(userId);
    if (hit && hit.exp > now) return hit.banned;

    const { data, error } = await supabase
        .from('users')
        .select('is_banned')
        .eq('id', userId)
        .single();

    if (error) {
        console.warn('isBanned() DB error:', error.message);
        return false;
    }
    const banned = Boolean(data?.is_banned);
    banCache.set(userId, { banned, exp: now + BAN_CACHE_TTL_MS });
    return banned;
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

    if (await isBanned(decoded.id)) {
        return res.status(403).json({ error: 'Compte banni' });
    }

    req.user = decoded;
    req.token = token;
    next();
};

module.exports.isBanned = isBanned;
module.exports.readToken = readToken;
