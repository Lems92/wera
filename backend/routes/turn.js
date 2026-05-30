const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');

// ── TURN credentials proxy ──────────────────────────────────────────────
// The frontend can't reach two carrier-NAT'd mobile clients with STUN
// alone — it needs a TURN relay. This endpoint returns iceServers for
// PeerJS / RTCPeerConnection to use.
//
// Three providers, picked in this order of preference:
//
//   1. Cloudflare Realtime TURN (1 TB/mo free, but requires a CC on file)
//      env: CF_TURN_TOKEN_ID, CF_TURN_API_TOKEN
//
//   2. Metered.ca paid/free tier (50 GB/mo free, signup but no CC)
//      env: METERED_TURN_DOMAIN (e.g. "wera.metered.live"),
//           METERED_TURN_API_KEY
//
//   3. Open Relay Project — public TURN servers maintained by Metered,
//      no signup, no card, no analytics. Fine to start with; swap to one
//      of the above once traffic grows.
//
// The frontend never sees long-lived secrets — only short-lived credentials
// (or in the Open-Relay case, public ones that are useless on their own).

const TTL_SECONDS = 600; // 10 minutes for short-lived credentials.

// Always-on STUN. STUN is free and used as a first ICE candidate before
// falling back to TURN relay.
const STUN_FALLBACK = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' }
];

// Public TURN credentials shared by Metered's Open Relay Project.
// Reference: https://www.metered.ca/tools/openrelay/
const OPEN_RELAY_ICE = [
    {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    }
];

async function fromCloudflare() {
    const tokenId = process.env.CF_TURN_TOKEN_ID;
    const apiToken = process.env.CF_TURN_API_TOKEN;
    if (!tokenId || !apiToken) return null;

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
        console.warn('CF TURN failed:', cfRes.status, await cfRes.text().catch(() => ''));
        return null;
    }
    const data = await cfRes.json();
    const iceServers = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers].filter(Boolean);
    return { provider: 'cloudflare', iceServers };
}

async function fromMetered() {
    const domain = process.env.METERED_TURN_DOMAIN;
    const apiKey = process.env.METERED_TURN_API_KEY;
    if (!domain || !apiKey) return null;

    const url = `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
        console.warn('Metered TURN failed:', res.status, await res.text().catch(() => ''));
        return null;
    }
    const iceServers = await res.json(); // already in iceServers shape
    return { provider: 'metered', iceServers };
}

router.get('/credentials', auth, async (req, res) => {
    try {
        const cf = await fromCloudflare();
        if (cf) {
            return res.json({
                iceServers: [...STUN_FALLBACK, ...cf.iceServers],
                provider: cf.provider,
                ttl: TTL_SECONDS,
                relayAvailable: true
            });
        }

        const metered = await fromMetered();
        if (metered) {
            return res.json({
                iceServers: [...STUN_FALLBACK, ...metered.iceServers],
                provider: metered.provider,
                ttl: TTL_SECONDS,
                relayAvailable: true
            });
        }

        // Fallback: Open Relay Project (free, public, no auth).
        res.json({
            iceServers: [...STUN_FALLBACK, ...OPEN_RELAY_ICE],
            provider: 'openrelay',
            ttl: TTL_SECONDS,
            relayAvailable: true,
            notice: 'Using free public TURN. Reliability not guaranteed.'
        });
    } catch (err) {
        console.error('TURN credentials error:', err?.message || err);
        // Even in the worst case, ship STUN + Open Relay so the app
        // keeps a chance to connect.
        res.json({
            iceServers: [...STUN_FALLBACK, ...OPEN_RELAY_ICE],
            provider: 'openrelay-fallback',
            ttl: TTL_SECONDS,
            relayAvailable: true
        });
    }
});

module.exports = router;
