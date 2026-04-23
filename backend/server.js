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

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const io = new Server(server, {
    cors: { origin: FRONTEND_URL, methods: ['GET', 'POST'] }
});
app.use(cors({ origin: FRONTEND_URL }));;
app.use(express.json());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);

app.get('/api', (req, res) => res.json({ status: 'ok', message: 'Wera API is accessible' }));
app.get('/', (req, res) => res.json({ message: 'Wera API is running 🇲🇬' }));

app.get('/api/check-location', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Autoriser localhost et les réseaux locaux (192.168.x.x, 10.x.x.x, 172.16.x.x, etc.)
    const isLocal = ip === '::1' || ip === '127.0.0.1' ||
        ip.startsWith('192.168.') || ip.startsWith('10.') ||
        ip.startsWith('172.') || ip.startsWith('::ffff:192.168.') ||
        ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:172.');

    if (isLocal) {
        return res.json({ allowed: true, country: 'Local Network 🇲🇬' });
    }
    try {
        const response = await fetch(`http://ip-api.com/json/${ip}`);
        const data = await response.json();
        res.json({ allowed: data.countryCode === 'MG', country: data.country });
    } catch {
        res.json({ allowed: false });
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
