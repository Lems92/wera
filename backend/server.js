require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const selfsigned = require('selfsigned');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');

const app = express();

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
    if (ALLOWED_ORIGINS.includes('*')) return true;
    if (ALLOWED_ORIGINS.includes(origin)) return true;

    // Production-friendly allowlist for common hosted frontends when env isn't set.
    // (Keeps local dev strict while preventing "mystery 400" Socket.IO handshakes on Render.)
    if (IS_RENDER) {
        try {
            const { hostname, protocol } = new URL(origin);
            if (protocol === 'https:' && (hostname.endsWith('.onrender.com') || hostname.endsWith('.vercel.app') || hostname.endsWith('.netlify.app'))) {
                return true;
            }
        } catch {
            // ignore invalid origins
        }
    }

    return false;
}

const corsOptions = {
    origin(origin, cb) {
        if (isOriginAllowed(origin)) return cb(null, true);
        return cb(new Error(`CORS blocked for origin: ${origin}. Set FRONTEND_URLS to allow it.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
};

const io = new Server(server, {
    cors: corsOptions,
    transports: ['websocket', 'polling']
});

// Helpful diagnostics for Render logs when the Engine.IO handshake fails.
io.engine.on('connection_error', (err) => {
    // err: { req, code, message, context }
    const origin = err?.req?.headers?.origin;
    const ua = err?.req?.headers?.['user-agent'];
    console.log('❌ Engine.IO connection_error', {
        code: err.code,
        message: err.message,
        origin,
        ua
    });
});
app.use(cors(corsOptions));
app.use(express.json());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);

app.get('/api', (req, res) => res.json({ status: 'ok', message: 'Wera API is accessible' }));
app.get('/', (req, res) => res.json({ message: 'Wera API is running 🇲🇬' }));

app.get('/api/check-location', async (req, res) => {
    // No country restriction: always allow.
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
        ?.split(',')[0]
        ?.trim() || req.socket.remoteAddress;

    try {
        const response = await fetch(`http://ip-api.com/json/${ip}`);
        const data = await response.json();
        res.json({ allowed: true, country: data.country, countryCode: data.countryCode, ip });
    } catch {
        res.json({ allowed: true, ip });
    }
});

// ─── Matchmaking ───────────────────────────────────────────
const waitingQueue = [];          // file d'attente
const activePairs = new Map();    // socketId -> socketId

io.on('connection', (socket) => {
    console.log('✅ Connecté:', socket.id);

    // L'utilisateur cherche un partenaire
    socket.on('find_partner', ({ peerId, username }) => {
        socket.data.peerId = peerId;
        socket.data.username = username;

        // Si quelqu'un attend déjà → on les apparie
        if (waitingQueue.length > 0) {
            const partner = waitingQueue.shift();

            // Enregistre la paire
            activePairs.set(socket.id, partner.id);
            activePairs.set(partner.id, socket.id);

            // Notifie les deux : qui appelle, qui répond
            socket.emit('partner_found', {
                partnerPeerId: partner.data.peerId,
                partnerUsername: partner.data.username,
                initiator: false   // socket reçoit l'appel
            });
            partner.emit('partner_found', {
                partnerPeerId: socket.data.peerId,
                partnerUsername: socket.data.username,
                initiator: true    // partner initie l'appel
            });

            console.log(`🔗 Paire: ${socket.id} <-> ${partner.id}`);
        } else {
            // Personne ne cherche → on attend
            waitingQueue.push(socket);
            socket.emit('waiting');
        }
    });

    // Message texte
    socket.on('send_message', (message) => {
        const partnerId = activePairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('receive_message', {
                text: message,
                from: socket.data.username,
                time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            });
        }
    });

    // Passer au suivant
    socket.on('skip', () => {
        leaveCurrentPair(socket);
        socket.emit('skipped');
    });

    // Déconnexion
    socket.on('disconnect', () => {
        leaveCurrentPair(socket);
        const idx = waitingQueue.indexOf(socket);
        if (idx !== -1) waitingQueue.splice(idx, 1);
        console.log('❌ Déconnecté:', socket.id);
    });
});

function leaveCurrentPair(socket) {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
        io.to(partnerId).emit('partner_left');
        activePairs.delete(partnerId);
        activePairs.delete(socket.id);
    }
}

const PORT = process.env.PORT || 3001;
// Avoid forcing a host binding; Render will route traffic via PORT.
server.listen(PORT, () => console.log(`✅ Wera server running on port ${PORT}`));
