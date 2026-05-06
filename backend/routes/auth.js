const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { OAuth2Client } = require('google-auth-library');

function validatePassword(password) {
    if (typeof password !== 'string') return 'Mot de passe invalide';
    const rules = [
        { ok: password.length >= 8, msg: 'Au moins 8 caractères' },
        { ok: /[a-z]/.test(password), msg: '1 lettre minuscule' },
        { ok: /[A-Z]/.test(password), msg: '1 lettre majuscule' },
        { ok: /\d/.test(password), msg: '1 chiffre' },
        { ok: /[^\w\s]/.test(password), msg: '1 caractère spécial' }
    ];
    const missing = rules.filter(r => !r.ok).map(r => r.msg);
    if (missing.length) return `Mot de passe trop faible: ${missing.join(', ')}`;
    return null;
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

async function ensureUniqueUsername(desired) {
    const base = normalizeUsername(desired) || `user_${Math.random().toString(16).slice(2, 8)}`;
    let candidate = base;
    for (let i = 0; i < 10; i++) {
        const { data } = await supabase
            .from('users')
            .select('id')
            .eq('username', candidate)
            .maybeSingle();
        if (!data) return candidate;
        candidate = `${base}_${Math.floor(Math.random() * 1000)}`;
    }
    return `${base}_${Math.floor(Math.random() * 100000)}`;
}

// Inscription
router.post('/register', async (req, res) => {
    const { username, email, password, age, sexe, ville, pays } = req.body;

    if (!username || !email || !password || age === undefined || !sexe || !ville || !pays)
        return res.status(400).json({ error: 'Champs manquants' });

    try {
        const ageNum = Number(age);
        if (!Number.isInteger(ageNum) || ageNum < 13 || ageNum > 120) {
            return res.status(400).json({ error: 'Âge invalide (13–120)' });
        }
        const pwError = validatePassword(password);
        if (pwError) return res.status(400).json({ error: pwError });

        const hash = await bcrypt.hash(password, 10);
        const { data, error } = await supabase
            .from('users')
            .insert([{
                username,
                email,
                password_hash: hash,
                age: ageNum,
                sexe,
                ville,
                pays
            }])
            .select()
            .single();

        if (error) return res.status(400).json({ error: 'Email ou username déjà utilisé' });

        const token = jwt.sign(
            { id: data.id, username: data.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, user: { id: data.id, username: data.username } });
    } catch (err) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Connexion
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (!user) return res.status(400).json({ error: 'Utilisateur introuvable' });
        if (user.is_banned) return res.status(403).json({ error: 'Compte banni' });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(400).json({ error: 'Mot de passe incorrect' });

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, user: { id: user.id, username: user.username } });
    } catch (err) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Connexion Google (Google Identity Services)
router.post('/google', async (req, res) => {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Token Google manquant' });

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID non configuré sur le serveur' });

    try {
        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: googleClientId
        });
        const payload = ticket.getPayload();
        const email = payload?.email;
        const emailVerified = payload?.email_verified;
        const name = payload?.name || payload?.given_name || payload?.family_name || '';

        if (!email) return res.status(400).json({ error: 'Email Google introuvable' });
        if (!emailVerified) return res.status(403).json({ error: 'Email Google non vérifié' });

        // Find user by email
        const { data: existing, error: findErr } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        if (findErr) return res.status(500).json({ error: 'Erreur serveur' });

        let user = existing;
        if (!user) {
            const username = await ensureUniqueUsername(name || email.split('@')[0]);
            // We still store a password_hash to avoid schema issues if it's NOT NULL.
            const randomPw = `${payload?.sub || 'google'}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
            const hash = await bcrypt.hash(randomPw, 10);

            const { data: created, error: createErr } = await supabase
                .from('users')
                .insert([{ username, email, password_hash: hash }])
                .select()
                .single();
            if (createErr) return res.status(400).json({ error: 'Impossible de créer le compte Google' });
            user = created;
        }

        if (user.is_banned) return res.status(403).json({ error: 'Compte banni' });

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, user: { id: user.id, username: user.username } });
    } catch (err) {
        res.status(400).json({ error: 'Token Google invalide' });
    }
});

module.exports = router;