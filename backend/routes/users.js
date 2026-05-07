const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/authMiddleware');
const jwt = require('jsonwebtoken');

const USERNAME_RE = /^[a-z0-9._-]{3,24}$/;
const MAX_SEXE = 20;
const MAX_VILLE = 60;
const MAX_PAYS = 60;
const MIN_AGE = 13;
const MAX_AGE = 120;

function pickUserRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        email: row.email,
        age: row.age,
        sexe: row.sexe,
        ville: row.ville,
        pays: row.pays
    };
}

function normalizeUsername(raw) {
    const base = String(raw || '').trim();
    if (!base) return null;
    const cleaned = base
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24);
    return cleaned || null;
}

function trimCap(value, max) {
    return String(value ?? '').trim().slice(0, max);
}

router.get('/me', auth, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, email, age, sexe, ville, pays')
            .eq('id', req.user.id)
            .single();

        if (error || !user) return res.status(404).json({ error: 'Utilisateur introuvable' });
        res.json({ user: pickUserRow(user) });
    } catch (err) {
        console.error('users/me GET error:', err?.message || err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

router.put('/me', auth, async (req, res) => {
    const { username, age, sexe, ville, pays } = req.body || {};

    const patch = {};
    if (username !== undefined) {
        const normalized = normalizeUsername(username);
        if (!normalized || !USERNAME_RE.test(normalized)) {
            return res.status(400).json({ error: 'Username invalide (3-24 caractères, lettres/chiffres/_-.)' });
        }
        patch.username = normalized;
    }
    if (age !== undefined) {
        const ageNum = Number(age);
        if (!Number.isInteger(ageNum) || ageNum < MIN_AGE || ageNum > MAX_AGE) {
            return res.status(400).json({ error: `Âge invalide (${MIN_AGE}–${MAX_AGE})` });
        }
        patch.age = ageNum;
    }
    if (sexe !== undefined) {
        const v = trimCap(sexe, MAX_SEXE);
        if (!v) return res.status(400).json({ error: 'Sexe invalide' });
        patch.sexe = v;
    }
    if (ville !== undefined) {
        const v = trimCap(ville, MAX_VILLE);
        if (!v) return res.status(400).json({ error: 'Ville invalide' });
        patch.ville = v;
    }
    if (pays !== undefined) {
        const v = trimCap(pays, MAX_PAYS);
        if (!v) return res.status(400).json({ error: 'Pays invalide' });
        patch.pays = v;
    }

    // Reject unknown fields silently — never let the body set arbitrary
    // columns like is_banned or password_hash through this endpoint.
    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'Aucun champ à modifier' });
    }

    try {
        const { data: updated, error } = await supabase
            .from('users')
            .update(patch)
            .eq('id', req.user.id)
            .select('id, username, email, age, sexe, ville, pays')
            .single();

        if (error || !updated) {
            // Likely unique violation on username. Generic to avoid leaking
            // which usernames are taken (combined with the fact that the
            // username is normalized, this gives little to enumerate).
            return res.status(400).json({ error: 'Impossible de mettre à jour le profil' });
        }

        // If username changed, return a fresh JWT so token payload stays accurate.
        const token = jwt.sign(
            { id: updated.id, username: updated.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, user: pickUserRow(updated) });
    } catch (err) {
        console.error('users/me PUT error:', err?.message || err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

module.exports = router;
