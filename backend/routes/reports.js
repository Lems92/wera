const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const supabase = require('../config/supabase');
const auth = require('../middleware/authMiddleware');
const blocklist = require('../lib/blocklist');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NOTE_LEN = 500;
const MAX_CALLID_LEN = 64;

// Enum des motifs (docs/SIGNALEMENT.md §3) + correspondance depuis les
// libellés affichés dans l'UI d'appel. La gravité est dérivée côté console.
const REASONS = new Set(['sexual_content', 'minor', 'hate_speech', 'harassment', 'spam', 'other']);
const LABEL_TO_REASON = [
    [/nudit|sexuel/i, 'sexual_content'],
    [/mineur/i, 'minor'],
    [/hain|racis/i, 'hate_speech'],
    [/harc|menace/i, 'harassment'],
    [/spam|publicit/i, 'spam']
];

function normalizeReason(raw) {
    const v = String(raw || '').trim();
    if (REASONS.has(v)) return v;
    for (const [re, enumVal] of LABEL_TO_REASON) {
        if (re.test(v)) return enumVal;
    }
    return v ? 'other' : null;
}

// Per-user rate limit: 10 reports / 10 min.
const reportLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.realIp || req.ip,
    message: { error: 'Trop de signalements. Réessayez plus tard.' }
});

router.post('/', auth, reportLimiter, async (req, res) => {
    const body = req.body || {};
    const reportedId = String(body.reported_id || body.reportedUserId || '').trim();
    const reason = normalizeReason(body.reason);
    const note = String(body.note || '').trim().slice(0, MAX_NOTE_LEN) || null;
    const callId = String(body.callId || body.call_id || '').trim().slice(0, MAX_CALLID_LEN) || null;

    if (!UUID_RE.test(reportedId)) {
        return res.status(400).json({ error: 'reported_id invalide' });
    }
    if (reportedId === req.user.id) {
        return res.status(400).json({ error: 'Auto-signalement non autorisé' });
    }
    if (!reason) {
        return res.status(400).json({ error: 'Motif requis' });
    }

    try {
        // Anti-abus (spec §9) : 1 signalement max par (signaleur, appel).
        if (callId) {
            const { data: dup } = await supabase
                .from('reports')
                .select('id')
                .eq('reporter_id', req.user.id)
                .eq('call_id', callId)
                .maybeSingle();
            if (dup) {
                // Idempotent : l'action de protection est déjà en place.
                blocklist.block(req.user.id, reportedId);
                return res.json({ message: 'Signalement déjà enregistré' });
            }
        }

        const { data: target, error: lookupErr } = await supabase
            .from('users')
            .select('id')
            .eq('id', reportedId)
            .single();
        if (lookupErr || !target) {
            return res.status(404).json({ error: 'Utilisateur signalé introuvable' });
        }

        // Insertion avec les colonnes de modération ; si la migration SQL
        // n'est pas encore passée (colonnes absentes), on retombe sur le
        // schéma historique pour ne jamais perdre un signalement.
        let { error } = await supabase
            .from('reports')
            .insert([{
                reporter_id: req.user.id,
                reported_id: reportedId,
                reason,
                note,
                call_id: callId,
                status: 'open'
            }]);
        if (error && /note|call_id|status|column|schema/i.test(error.message || '')) {
            console.warn('reports: colonnes modération absentes (migration à passer) —', error.message);
            ({ error } = await supabase
                .from('reports')
                .insert([{ reporter_id: req.user.id, reported_id: reportedId, reason }]));
        }
        if (error) {
            console.error('report insert error:', error.message);
            return res.status(500).json({ error: 'Erreur signalement' });
        }

        // Action automatique immédiate (spec §2) :
        // 1. la paire ne sera plus jamais réappariée,
        blocklist.block(req.user.id, reportedId);
        // 2. l'appel en cours est coupé côté serveur (le signalé est remis
        //    en file ; le signaleur a déjà quitté côté client).
        const breakPair = req.app.get('breakPairByUser');
        if (typeof breakPair === 'function') breakPair(req.user.id);

        res.status(201).json({ message: 'Signalement envoyé' });
    } catch (err) {
        console.error('report error:', err?.message || err);
        res.status(500).json({ error: 'Erreur signalement' });
    }
});

module.exports = router;
