const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');

// ── Cloudflare Realtime TURN credentials proxy ──────────────────────────
// Browser code never sees the long-lived API token. The client calls this
// endpoint (with its JWT cookie) and gets back short-lived (10 min) TURN
// credentials it can plug into PeerJS / RTCPeerConnection.iceServers.
//
// Required env vars:
//   CF_TURN_TOKEN_ID  — the public TURN token id from Cloudflare dashboard
//   CF_TURN_API_TOKEN — the secret API token from Cloudflare dashboard
//
// Doc: https://developers.cloudflare.com/realtime/turn/

const TTL_SECONDS = 600; // 10 minutes; CF caps this at ~24h

router.get('/credentials', auth, async (req, res) => {
    const tokenId = process.env.CF_TURN_TOKEN_ID;
    const apiToken = process.env.CF_TURN_API_TOKEN;

    if (!tokenId || !apiToken) {
        // Fallback: STUN-only. Calls between mobile-mobile will fail to
        // connect but at least the rest of the app keeps working.
        return res.json({
            iceServers: [
                { urls: 'stun:stun.cloudflare.com:3478' },
                { urls: 'stun:stun.l.google.com:19302' }
            ],
            ttl: TTL_SECONDS,
            relayAvailable: false
        });
    }

    try {
        const cfRes = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/generate-ice-servers`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ttl: TTL_SECONDS })
            }
        );

        if (!cfRes.ok) {
            const text = await cfRes.text().catch(() => '');
            console.warn('CF TURN generate failed:', cfRes.status, text);
            return res.status(502).json({ error: 'TURN service unavailable' });
        }

        const data = await cfRes.json();
        // CF returns { iceServers: { urls: [...], username, credential } }
        // Normalize to an array shape that RTCPeerConnection / PeerJS expects.
        const iceServers = Array.isArray(data.iceServers)
            ? data.iceServers
            : [data.iceServers].filter(Boolean);

        res.json({
            iceServers: [
                { urls: 'stun:stun.cloudflare.com:3478' },
                ...iceServers
            ],
            ttl: TTL_SECONDS,
            relayAvailable: true
        });
    } catch (err) {
        console.error('TURN credentials error:', err?.message || err);
        res.status(500).json({ error: 'TURN service error' });
    }
});

module.exports = router;
