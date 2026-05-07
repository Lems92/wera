require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const selfsigned = require('selfsigned');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const { isBanned } = require('./middleware/authMiddleware');

// ── Boot-time security checks ────────────────────────────────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET must be defined and at least 32 characters long.');
    process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_KEY must be defined.');
    process.exit(1);
}

const app = express();
// Trust the first proxy (Render terminates TLS in front of Node) so the
// real client IP from X-Forwarded-For is used by rate-limit and logging.
// Limited to 1 hop to prevent header-spoofing of arbitrary IPs.
app.set('trust proxy', 1);

// ── Minimal security headers (no extra dependency) ───────────────────────
// The API never serves HTML, so a tight CSP is safe and blocks any reflected
// content from being interpreted as a page in case of mistakes.
const API_CSP = [
    "default-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'"
].join('; ');

app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', API_CSP);
    if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// Configuration du serveur : HTTP pour Render (production), HTTPS local pour le mobile
// Render sets RENDER in the runtime environment; don't rely on a specific string value.
const IS_RENDER = Boolean(process.env.RENDER) || process.env.NODE_ENV === 'production';
let server;

if (IS_RENDER) {
    console.log('🌐 Mode Production/Render : Utilisation de HTTP');
    server = http.createServer(app);
} else {
    console.log('🔐 Mode Local : Utilisation de HTTPS (Self-signed)');
    // Générer un certificat auto-signé pour HTTPS avec l'IP réelle pour le téléphone
    const IP_ADDRESS = '192.168.88.26';
    const attrs = [{ name: 'commonName', value: IP_ADDRESS }];
    const extensions = [{
        name: 'subjectAltName',
        altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: IP_ADDRESS },
            { type: 7, ip: '127.0.0.1' }
        ]
    }];
    const pems = selfsigned.generate(attrs, { days: 365, extensions });
    server = https.createServer({
        key: pems.private,
        cert: pems.cert
    }, app);
}

function parseAllowedOrigins() {
    // Supports either FRONTEND_URL (single) or FRONTEND_URLS (comma-separated).
    // In production, if you don't set FRONTEND_URL(S), we still allow typical Render/Vercel/Netlify frontends.
    const raw = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '';

    const defaults = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ];

    const fromEnv = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    return Array.from(new Set([...defaults, ...fromEnv]));
}

const ALLOWED_ORIGINS = parseAllowedOrigins();

function isOriginAllowed(origin) {
    if (!origin) return true; // non-browser requests (no Origin header)
    if (ALLOWED_ORIGINS.includes(origin)) return true;

    // Static allowlist of known Wera frontends. We deliberately do NOT fall
    // back to "any HTTPS origin" — that would make CSRF trivially possible
    // for any logged-in user once another flaw allows credentialed requests.
    if (IS_RENDER) {
        try {
            const { hostname, protocol } = new URL(origin);
            if (protocol !== 'https:') return false;
            const ok = hostname === 'wera.mg' ||
                       hostname === 'www.wera.mg' ||
                       hostname.endsWith('.onrender.com') ||
                       hostname.endsWith('.vercel.app') ||
                       hostname.endsWith('.netlify.app');
            return ok;
        } catch {
            return false;
        }
    }
    return false;
}

const corsOptions = {
    origin(origin, cb) {
        if (isOriginAllowed(origin)) return cb(null, true);
        // Don't surface a stack trace to the client.
        return cb(null, false);
    },
    // Auth uses Bearer tokens (Authorization header), not cookies. Keeping
    // credentials:false prevents CSRF via stolen cookies even if a malicious
    // origin slips past the allowlist.
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600
};

const io = new Server(server, {
    cors: corsOptions,
    // Polling first lets clients survive Render free-tier cold-starts (30-60s)
    // where WebSocket would time out. Upgrades to websocket once the handshake
    // completes and the server is warm.
    transports: ['polling', 'websocket'],
    pingTimeout: 60000,
    pingInterval: 25000,
    allowEIO3: true,
    // Recover sessions across brief disconnects — avoids "Session ID unknown" 400
    // errors when Render briefly drops or restarts the connection mid-handshake.
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true
    }
});

// PeerJS signaling server (used by peerjs in the frontend)
const peerServer = ExpressPeerServer(server, {
    path: '/',
    proxied: true,
    // debug logged peer IDs and IPs — disabled in production.
    debug: !IS_RENDER,
    // Don't expose the full list of connected peer IDs via the discovery
    // endpoint. Without this, anyone can GET /peerjs/peerjs/peers and scrape
    // every active peer ID to call them out-of-band.
    allow_discovery: false,
    // Cap concurrent messages buffered server-side per client.
    concurrent_limit: 5000
});

app.use('/peerjs', peerServer);

// Don't log peer IDs in production — they're per-session identifiers but
// were leaking to Render's stdout.
if (!IS_RENDER) {
    peerServer.on('connection', (client) => {
        console.log('🧩 Peer connected:', client.getId());
    });
    peerServer.on('disconnect', (client) => {
        console.log('🧩 Peer disconnected:', client.getId());
    });
}

// Helpful diagnostics for Render logs when the Engine.IO handshake fails.
// Origin is the only piece useful for CORS debugging — UA was unnecessary PII.
io.engine.on('connection_error', (err) => {
    console.log('❌ Engine.IO connection_error', {
        code: err.code,
        message: err.message,
        origin: err?.req?.headers?.origin
    });
});
app.use(cors(corsOptions));
// Cap body size — chat messages are short and the API never receives uploads.
app.use(express.json({ limit: '32kb' }));

// Global API rate-limiter (broad). Strict per-route limits are added below.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', apiLimiter);

// Strict limiter for credential-handling endpoints (login/register).
// Mounted BEFORE the auth router so it actually intercepts the request.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // don't count valid logins toward the limit
    message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);

app.get('/api', (req, res) => res.json({ status: 'ok', message: 'Wera API is accessible' }));
app.get('/', (req, res) => res.json({ message: 'Wera API is running 🇲🇬' }));

app.get('/api/check-location', async (req, res) => {
    // No country restriction: always allow. We expose neither the raw IP nor
    // any third-party lookup result — the response is intentionally minimal
    // to avoid leaking PII (the previous version echoed the client IP back).
    res.json({ allowed: true });
});

// ─── Matchmaking ───────────────────────────────────────────
const waitingQueue = [];          // file d'attente
const activePairs = new Map();    // socketId -> socketId
const lastPartner = new Map();    // socketId -> previous partnerId (for anti-immediate-rematch)
const RECENT_PARTNER_WINDOW_MS = 30 * 1000; // avoid rematching the same person for 30s after a skip
const lastPartnerAt = new Map();  // socketId -> timestamp when lastPartner was recorded

function removeFromWaitingQueue(socket) {
    // Remove all occurrences (defensive against duplicates).
    for (let i = waitingQueue.length - 1; i >= 0; i--) {
        if (waitingQueue[i]?.id === socket.id) waitingQueue.splice(i, 1);
    }
}

function recentlyPaired(aId, bId) {
    const now = Date.now();
    const aPrev = lastPartner.get(aId);
    const bPrev = lastPartner.get(bId);
    const aTs = lastPartnerAt.get(aId) || 0;
    const bTs = lastPartnerAt.get(bId) || 0;
    if (aPrev === bId && now - aTs < RECENT_PARTNER_WINDOW_MS) return true;
    if (bPrev === aId && now - bTs < RECENT_PARTNER_WINDOW_MS) return true;
    return false;
}

// ── Socket.IO authentication middleware ──────────────────────────────────
// Requires a valid JWT in handshake.auth.token. Banned users are rejected.
io.use(async (socket, next) => {
    const token = socket.handshake?.auth?.token;
    if (!token) return next(new Error('Auth required'));

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return next(new Error('Invalid token'));
    }
    if (!decoded?.id) return next(new Error('Invalid token'));

    try {
        if (await isBanned(decoded.id)) return next(new Error('Banned'));
    } catch (err) {
        // Don't block legitimate users on a transient DB hiccup.
        console.warn('socket ban-check error:', err?.message || err);
    }

    socket.data.userId = decoded.id;
    socket.data.username = decoded.username; // authoritative; ignore client-supplied
    next();
});

// ── Input-validation helpers ─────────────────────────────────────────────
const PEERID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const MAX_MSG_LEN = 1000;

io.on('connection', (socket) => {
    // Don't log the user id in production logs.
    if (!IS_RENDER) console.log('✅ Connecté:', socket.id, 'user:', socket.data.userId);

    // L'utilisateur cherche un partenaire
    socket.on('find_partner', (payload) => {
        const peerId = String(payload?.peerId || '').trim();
        if (!PEERID_RE.test(peerId)) return; // silently drop malformed payloads
        socket.data.peerId = peerId;
        // username comes from the verified JWT, not from the client (set in io.use)

        // If already paired, ignore.
        if (activePairs.has(socket.id)) return;

        // Ensure the socket isn't already queued (prevents duplicates).
        removeFromWaitingQueue(socket);

        // Si quelqu'un attend déjà → on les apparie
        let partner;
        const recentSkipped = []; // valid candidates we deferred because of recent-pairing.
        while (waitingQueue.length > 0 && !partner) {
            const candidate = waitingQueue.shift();
            // Skip invalid / disconnected sockets or self-match.
            if (!candidate || candidate.disconnected) continue;
            if (candidate.id === socket.id) continue;
            // Skip if candidate already paired (stale queue entry).
            if (activePairs.has(candidate.id)) continue;
            // Defer recently-paired candidates so "Suivant" prefers someone new
            // — but keep them as a fallback if no one else is available.
            if (recentlyPaired(socket.id, candidate.id)) {
                recentSkipped.push(candidate);
                continue;
            }
            partner = candidate;
        }
        // Fallback: only the previous partner is online → reuse them rather than
        // leaving the user stuck in "Recherche...".
        if (!partner && recentSkipped.length) {
            partner = recentSkipped.shift();
        }
        // Re-queue any remaining deferred candidates at the head of the queue.
        if (recentSkipped.length) waitingQueue.unshift(...recentSkipped);

        if (partner) {

            // Enregistre la paire
            activePairs.set(socket.id, partner.id);
            activePairs.set(partner.id, socket.id);

            // Notifie les deux : qui appelle, qui répond.
            // partnerUserId = real DB id (UUID), used by /reports.
            socket.emit('partner_found', {
                partnerPeerId: partner.data.peerId,
                partnerUsername: partner.data.username,
                partnerUserId: partner.data.userId,
                initiator: false
            });
            partner.emit('partner_found', {
                partnerPeerId: socket.data.peerId,
                partnerUsername: socket.data.username,
                partnerUserId: socket.data.userId,
                initiator: true
            });

            if (!IS_RENDER) console.log(`🔗 Paire: ${socket.id} <-> ${partner.id}`);
        } else {
            // Personne ne cherche → on attend
            waitingQueue.push(socket);
            socket.emit('waiting');
        }
    });

    // Message texte. Validate type + length + that the sender is actually
    // paired — drop everything else silently.
    socket.on('send_message', (message) => {
        if (typeof message !== 'string') return;
        const text = message.trim();
        if (!text || text.length > MAX_MSG_LEN) return;

        const partnerId = activePairs.get(socket.id);
        if (!partnerId) return;

        io.to(partnerId).emit('receive_message', {
            text,
            from: socket.data.username,
            time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        });
    });

    // Passer au suivant — the client immediately re-emits 'find_partner',
    // so we don't send 'skipped' here (it would race the client into 'idle').
    socket.on('skip', () => {
        leaveCurrentPair(socket);
        removeFromWaitingQueue(socket);
    });

    // Annuler la recherche (quand l'utilisateur stop pendant "Recherche en cours...")
    socket.on('cancel_search', () => {
        removeFromWaitingQueue(socket);
        socket.emit('skipped');
    });

    // Déconnexion
    socket.on('disconnect', () => {
        leaveCurrentPair(socket);
        removeFromWaitingQueue(socket);
        // Clean up the anti-rematch trackers so we don't leak memory.
        lastPartner.delete(socket.id);
        lastPartnerAt.delete(socket.id);
        if (!IS_RENDER) console.log('❌ Déconnecté:', socket.id);
    });
});

function leaveCurrentPair(socket) {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
        io.to(partnerId).emit('partner_left');
        activePairs.delete(partnerId);
        activePairs.delete(socket.id);
        // Remember who just unpaired so we don't immediately rematch them.
        const now = Date.now();
        lastPartner.set(socket.id, partnerId);
        lastPartner.set(partnerId, socket.id);
        lastPartnerAt.set(socket.id, now);
        lastPartnerAt.set(partnerId, now);
    }
}

const PORT = process.env.PORT || 3001;
// Avoid forcing a host binding; Render will route traffic via PORT.
server.listen(PORT, () => console.log(`✅ Wera server running on port ${PORT}`));
