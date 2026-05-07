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

    // Fail closed on DB errors for safety, but don't lock everyone out — log it.
    if (error) {
        console.warn('isBanned() DB error:', error.message);
        return false;
    }
    const banned = Boolean(data?.is_banned);
    banCache.set(userId, { banned, exp: now + BAN_CACHE_TTL_MS });
    return banned;
}

module.exports = async function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non autorisé' });

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Token invalide' });
    }

    if (!decoded?.id) return res.status(401).json({ error: 'Token invalide' });

    if (await isBanned(decoded.id)) {
        return res.status(403).json({ error: 'Compte banni' });
    }

    req.user = decoded;
    next();
};

module.exports.isBanned = isBanned;
