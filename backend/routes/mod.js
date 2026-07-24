const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/authMiddleware');
const { invalidateRestrictionCache } = require('../middleware/authMiddleware');

// ── Console de modération (docs/SIGNALEMENT.md §7) ──────────────────────
// Accès réservé : ADMIN_USER_IDS = liste d'ids utilisateurs séparés par des
// virgules, définie sur Render. (Récupère ton id via GET /api/users/me.)
const ADMIN_IDS = new Set(
    String(process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
);

function requireAdmin(req, res, next) {
    if (!ADMIN_IDS.size) {
        return res.status(503).json({ error: 'Console non configurée (ADMIN_USER_IDS manquant sur le serveur)' });
    }
    if (!ADMIN_IDS.has(req.user.id)) {
        return res.status(403).json({ error: 'Accès réservé à l\'équipe de modération' });
    }
    next();
}

const SANCTION_ACTIONS = new Set(['dismiss', 'warn', 'suspend', 'ban']);
const SUSPEND_HOURS = 24;

// Les colonnes status / prior_sanctions / suspended_until arrivent avec la
// migration SQL. En leur absence on dégrade proprement plutôt que planter.
function isMissingColumn(error) {
    return error && /column|schema/i.test(error.message || '');
}

// ── GET /mod/reports — signalements ouverts, enrichis ───────────────────
// La console regroupe elle-même en dossiers (buildCases, spec §6 : en V0 le
// dossier est calculé, pas stocké).
router.get('/reports', auth, requireAdmin, async (_req, res) => {
    try {
        let { data: reports, error } = await supabase
            .from('reports')
            .select('id, reporter_id, reported_id, reason, note, call_id, status, created_at')
            .eq('status', 'open')
            .order('created_at', { ascending: false })
            .limit(500);
        if (isMissingColumn(error)) {
            ({ data: reports, error } = await supabase
                .from('reports')
                .select('id, reporter_id, reported_id, reason, created_at')
                .order('created_at', { ascending: false })
                .limit(500));
        }
        if (error) throw new Error(error.message);
        reports = reports || [];

        // Enrichit avec pseudo / ville / antécédents des membres concernés.
        const ids = [...new Set(reports.flatMap((r) => [r.reporter_id, r.reported_id]).filter(Boolean))];
        let usersById = new Map();
        if (ids.length) {
            let { data: users, error: uErr } = await supabase
                .from('users')
                .select('id, username, ville, prior_sanctions')
                .in('id', ids);
            if (isMissingColumn(uErr)) {
                ({ data: users, error: uErr } = await supabase
                    .from('users')
                    .select('id, username, ville')
                    .in('id', ids));
            }
            if (uErr) throw new Error(uErr.message);
            usersById = new Map((users || []).map((u) => [u.id, u]));
        }

        res.json({
            reports: reports.map((r) => {
                const reported = usersById.get(r.reported_id) || {};
                const reporter = usersById.get(r.reporter_id) || {};
                return {
                    id: r.id,
                    reason: r.reason,
                    note: r.note || null,
                    callId: r.call_id || null,
                    createdAt: r.created_at,
                    reportedId: r.reported_id,
                    reported: reported.username || 'compte supprimé',
                    reporter: reporter.username || 'Anonyme',
                    city: reported.ville || '—',
                    prior: reported.prior_sanctions || 0
                };
            })
        });
    } catch (err) {
        console.error('mod/reports error:', err?.message || err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ── POST /mod/cases/:reportedId/resolve — décision sur tout le dossier ──
router.post('/cases/:reportedId/resolve', auth, requireAdmin, async (req, res) => {
    const reportedId = String(req.params.reportedId || '').trim();
    const action = String(req.body?.action || '').trim();
    if (!SANCTION_ACTIONS.has(action)) {
        return res.status(400).json({ error: 'Action invalide (dismiss|warn|suspend|ban)' });
    }

    try {
        // Ferme tous les signalements ouverts du dossier d'un coup (spec §4).
        const { error: closeErr } = await supabase
            .from('reports')
            .update({ status: 'resolved' })
            .eq('reported_id', reportedId)
            .eq('status', 'open');
        if (isMissingColumn(closeErr)) {
            return res.status(503).json({
                error: 'Migration SQL requise (colonne reports.status manquante) — voir docs/MIGRATION-moderation.sql'
            });
        }
        if (closeErr) throw new Error(closeErr.message);

        if (action !== 'dismiss') {
            const { data: u, error: uErr } = await supabase
                .from('users')
                .select('id, prior_sanctions')
                .eq('id', reportedId)
                .single();
            if (uErr && !isMissingColumn(uErr)) throw new Error(uErr.message);

            const patch = { prior_sanctions: ((u && u.prior_sanctions) || 0) + 1 };
            if (action === 'suspend') {
                patch.suspended_until = new Date(Date.now() + SUSPEND_HOURS * 3600 * 1000).toISOString();
            }
            if (action === 'ban') patch.is_banned = true;

            let { error: sErr } = await supabase.from('users').update(patch).eq('id', reportedId);
            if (isMissingColumn(sErr)) {
                // Sans les colonnes de sanction, on applique au moins le ban.
                if (action === 'ban') {
                    ({ error: sErr } = await supabase.from('users').update({ is_banned: true }).eq('id', reportedId));
                } else {
                    sErr = null;
                    console.warn('mod: sanction "%s" non persistée (migration à passer)', action);
                }
            }
            if (sErr) throw new Error(sErr.message);
            invalidateRestrictionCache(reportedId);
        }

        res.json({ ok: true, action });
    } catch (err) {
        console.error('mod/resolve error:', err?.message || err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ── GET /mod/metrics — vue d'ensemble (spec §8) ─────────────────────────
// On renvoie ce qui est réellement mesurable aujourd'hui ; les métriques
// d'appels (non trackées en base) sont null et la console affiche « — ».
router.get('/metrics', auth, requireAdmin, async (_req, res) => {
    try {
        const { count: members } = await supabase
            .from('users')
            .select('id', { count: 'exact', head: true });

        let newMembers7d = null;
        try {
            const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
            const { count, error } = await supabase
                .from('users')
                .select('id', { count: 'exact', head: true })
                .gte('created_at', since);
            if (!error) newMembers7d = count;
        } catch { /* colonne created_at absente — tant pis */ }

        // Motifs sur 30 j (ouverts + résolus) pour la répartition.
        const since30 = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
        let { data: reps, error: rErr } = await supabase
            .from('reports')
            .select('reason, created_at')
            .gte('created_at', since30)
            .limit(2000);
        if (rErr) reps = [];
        const byReason = {};
        (reps || []).forEach((r) => { byReason[r.reason] = (byReason[r.reason] || 0) + 1; });

        // Top villes des membres.
        const { data: villes } = await supabase.from('users').select('ville').limit(2000);
        const cityCount = {};
        (villes || []).forEach((v) => {
            const c = String(v.ville || '').trim();
            if (!c || c === '—') return;
            cityCount[c] = (cityCount[c] || 0) + 1;
        });
        const topCities = Object.entries(cityCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6);

        res.json({
            members: members ?? null,
            newMembers7d,
            reportsByReason30d: byReason,
            topCities,
            // Pas encore mesuré côté serveur — la console affiche « — ».
            callsToday: null,
            avgCallDuration: null,
            callsByDay: null
        });
    } catch (err) {
        console.error('mod/metrics error:', err?.message || err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

module.exports = router;
