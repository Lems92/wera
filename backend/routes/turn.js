const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');

// ── TURN credentials proxy ──────────────────────────────────────────────
// The frontend can't reach two carrier-NAT'd mobile clients with STUN
// alone — it needs a TURN relay. This endpoint returns iceServers for
// PeerJS / RTCPeerConnection to use.
//
// Providers, picked in this order of preference:
//
//   1. Cloudflare Realtime TURN (1 TB/mo free, but requires a CC on file)
//      env: CF_TURN_TOKEN_ID, CF_TURN_API_TOKEN
//
//   2. Metered.ca free tier (50 GB/mo free, signup but no CC)
//      env: METERED_TURN_DOMAIN (e.g. "wera.metered.live"),
//           METERED_TURN_API_KEY
//
//   3. Any provider handing out static credentials (ExpressTURN,
//      self-hosted coturn, …):
//      env: TURN_URLS       comma-separated, e.g.
//                           "turn:relay.example.com:3478,turns:relay.example.com:443?transport=tcp"
//           TURN_USERNAME, TURN_CREDENTIAL
//
// NOTE: the old anonymous "Open Relay Project" fallback
// (openrelay.metered.ca + openrelayproject/openrelayproject) is GONE —
// Metered retired it. Verified 2026-05 with a real TURN Allocate: port 443
// refuses TCP outright and port 80 accepts TCP but never answers. Shipping
// those endpoints only slowed ICE gathering while CGNAT↔CGNAT calls stayed
// dead, so we no longer include them. With no provider configured we return
// STUN-only and relayAvailable:false.
//
// The frontend never sees long-lived secrets from Cloudflare/Metered — only
// short-lived credentials. Static TURN_* creds are by nature long-lived;
// prefer providers 1/2 when possible.

// 6 hours. This must comfortably outlive both a whole chat session and any
// single call: TURN allocations are refreshed with the ORIGINAL credential,
// so when the credential expires mid-call the refresh is rejected and the
// relayed stream dies on the spot — with 600s this cut every mobile↔mobile
// call at ~10 minutes (or sooner, since the frontend fetched credentials
// once per page load).
const TTL_SECONDS = 21600;

// Always-on STUN. STUN is free and used as a first ICE candidate before
// falling back to TURN relay.
const STUN_FALLBACK = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' }
];

// Loud boot-time warning: without a TURN relay, two clients that are both
// behind carrier-grade NAT (mobile-data ↔ mobile-data) cannot connect at all.
if (!process.env.CF_TURN_TOKEN_ID && !process.env.METERED_TURN_DOMAIN && !process.env.TURN_URLS) {
    console.warn(
        '⚠️  TURN: aucun relais configuré (CF_TURN_*, METERED_TURN_* ou TURN_URLS). ' +
        'Les appels mobile↔mobile (CGNAT des deux côtés) échoueront. ' +
        'Compte gratuit sur metered.ca puis définir METERED_TURN_DOMAIN + METERED_TURN_API_KEY.'
    );
}

function fromStaticEnv() {
    const urls = (process.env.TURN_URLS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const username = process.env.TURN_USERNAME;
    const credential = process.env.TURN_CREDENTIAL;
    if (!urls.length || !username || !credential) return null;
    return {
        provider: 'static',
        iceServers: urls.map((u) => ({ urls: u, username, credential }))
    };
}

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
    const key = process.env.METERED_TURN_API_KEY;
    if (!domain || !key) return null;

    const FETCH_OPTS = { signal: AbortSignal.timeout(5000) };

    // The env var accepts either of Metered's two key types:
    //
    //  Flow 1 — TURN "API Key" (shown on the TURN Servers page): one GET
    //  returns the ready-made iceServers array.
    const direct = await fetch(
        `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`,
        FETCH_OPTS
    );
    if (direct.ok) {
        const iceServers = await direct.json(); // already in iceServers shape
        return { provider: 'metered', iceServers };
    }

    //  Flow 2 — account "Secret Key" (Developers page): mint a short-lived
    //  credential via the admin API, then list its ice servers with the
    //  per-credential apiKey Metered returns. This is what makes the setup
    //  work even when the user copied the Secret Key into
    //  METERED_TURN_API_KEY (easy mistake — both live in the dashboard).
    const mint = await fetch(
        `https://${domain}/api/v1/turn/credential?secretKey=${encodeURIComponent(key)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expiryInSeconds: TTL_SECONDS, label: 'wera' }),
            signal: AbortSignal.timeout(5000)
        }
    );
    if (!mint.ok) {
        console.warn(
            'Metered TURN failed — direct:', direct.status,
            '| mint:', mint.status, await mint.text().catch(() => '')
        );
        return null;
    }
    const cred = await mint.json();
    if (!cred?.apiKey) {
        console.warn('Metered TURN: credential minted but no apiKey in response');
        return null;
    }
    const list = await fetch(
        `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(cred.apiKey)}`,
        FETCH_OPTS
    );
    if (!list.ok) {
        console.warn('Metered TURN failed (list after mint):', list.status);
        return null;
    }
    const iceServers = await list.json();
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

        const fixed = fromStaticEnv();
        if (fixed) {
            return res.json({
                iceServers: [...STUN_FALLBACK, ...fixed.iceServers],
                provider: fixed.provider,
                ttl: TTL_SECONDS,
                relayAvailable: true
            });
        }

        // No relay configured: STUN only. Same-NAT-friendly networks (wifi,
        // wifi↔mobile) still connect; CGNAT↔CGNAT will not.
        res.json({
            iceServers: STUN_FALLBACK,
            provider: 'stun-only',
            ttl: TTL_SECONDS,
            relayAvailable: false,
            notice: 'Aucun relais TURN configuré — les appels mobile↔mobile échoueront.'
        });
    } catch (err) {
        console.error('TURN credentials error:', err?.message || err);
        res.json({
            iceServers: STUN_FALLBACK,
            provider: 'stun-only',
            ttl: TTL_SECONDS,
            relayAvailable: false
        });
    }
});

module.exports = router;
