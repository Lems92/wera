const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const supabase = require('../config/supabase');
const auth = require('../middleware/authMiddleware');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REASON_LEN = 500;

// Per-user rate limit: 10 reports / 10 min. Keyed by JWT user id when
// available, falling back to the Cloudflare-resolved client IP.
const reportLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.realIp || req.ip,
    message: { error: 'Trop de signalements. Réessayez plus tard.' }
});

router.post('/', auth, reportLimiter, async (req, res) => {
    const reportedId = String(req.body?.reported_id || '').trim();
    const reason = String(req.body?.reason || '').trim().slice(0, MAX_REASON_LEN);

    if (!UUID_RE.test(reportedId)) {
        return res.status(400).json({ error: 'reported_id invalide' });
    }
    if (reportedId === req.user.id) {
        return res.status(400).json({ error: 'Auto-signalement non autorisé' });
    }
    if (!reason) {
        return res.status(400).json({ error: 'Raison requise' });
    }

    // Verify the reported user actually exists, to keep the table clean.
    const { data: target, error: lookupErr } = await supabase
        .from('users')
        .select('id')
        .eq('id', reportedId)
        .single();
    if (lookupErr || !target) {
        return res.status(404).json({ error: 'Utilisateur signalé introuvable' });
    }

    const { error } = await supabase
        .from('reports')
        .insert([{ reporter_id: req.user.id, reported_id: reportedId, reason }]);

    if (error) {
        console.error('report insert error:', error.message);
        return res.status(500).json({ error: 'Erreur signalement' });
    }

    res.json({ message: 'Signalement envoyé' });
});

module.exports = router;
