const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/authMiddleware');
const jwt = require('jsonwebtoken');

function pickUserRow(row) {
    if (!row) return null;
    // Keep frontend-safe fields only.
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

router.get('/me', auth, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, email, age, sexe, ville, pays')
            .eq('id', req.user.id)
            .single();

        if (error || !user) return res.status(404).json({ error: 'Utilisateur introuvable' });
        res.json({ user: pickUserRow(user) });
    } catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

router.put('/me', auth, async (req, res) => {
    const { username, age, sexe, ville, pays } = req.body || {};

    const patch = {};
    if (username !== undefined) {
        const normalized = normalizeUsername(username);
        if (!normalized) return res.status(400).json({ error: 'Username invalide' });
        patch.username = normalized;
    }
    if (age !== undefined) {
        const ageNum = Number(age);
        if (!Number.isInteger(ageNum) || ageNum < 13 || ageNum > 120) {
            return res.status(400).json({ error: 'Âge invalide (13–120)' });
        }
        patch.age = ageNum;
    }
    if (sexe !== undefined) patch.sexe = String(sexe || '').trim() || null;
    if (ville !== undefined) patch.ville = String(ville || '').trim() || null;
    if (pays !== undefined) patch.pays = String(pays || '').trim() || null;

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
            // Likely unique violation on username.
            return res.status(400).json({ error: 'Impossible de mettre à jour le profil' });
        }

        // If username changed, return a fresh JWT so token payload stays accurate.
        const token = jwt.sign(
            { id: updated.id, username: updated.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, user: pickUserRow(updated) });
    } catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

module.exports = router;
