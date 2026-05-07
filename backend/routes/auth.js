const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { OAuth2Client } = require('google-auth-library');

// ── Constants ────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 100;
const MIN_AGE = 13;
const MAX_AGE = 120;

// ── Helpers ──────────────────────────────────────────────────────────────
function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
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

function validatePassword(password) {
    if (typeof password !== 'string') return 'Mot de passe invalide';
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
        return `Mot de passe : ${MIN_PASSWORD} à ${MAX_PASSWORD} caractères`;
    }
    const rules = [
        { ok: /[a-z]/.test(password), msg: '1 lettre minuscule' },
        { ok: /[A-Z]/.test(password), msg: '1 lettre majuscule' },
        { ok: /\d/.test(password), msg: '1 chiffre' },
        { ok: /[^\w\s]/.test(password), msg: '1 caractère spécial' }
    ];
    const missing = rules.filter(r => !r.ok).map(r => r.msg);
    if (missing.length) return `Mot de passe trop faible: ${missing.join(', ')}`;
    return null;
}

function signToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

// ── Inscription ──────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    const { age, sexe, ville, pays } = req.body || {};

    if (!username || !email || !password ||
        age === undefined || age === null || !sexe || !ville || !pays) {
        return res.status(400).json({ error: 'Champs manquants' });
    }
    if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'Email invalide' });
    }
    const ageNum = Number(age);
    if (!Number.isInteger(ageNum) || ageNum < MIN_AGE || ageNum > MAX_AGE) {
        return res.status(400).json({ error: `Âge invalide (${MIN_AGE}–${MAX_AGE})` });
    }
    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    // Bound the free-text fields server-side. Keeps the DB tidy and limits
    // the surface for nuisance content.
    const sexeStr = String(sexe).trim().slice(0, 20);
    const villeStr = String(ville).trim().slice(0, 60);
    const paysStr = String(pays).trim().slice(0, 60);
    if (!sexeStr || !villeStr || !paysStr) {
        return res.status(400).json({ error: 'Champs manquants' });
    }

    try {
        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const { data, error } = await supabase
            .from('users')
            .insert([{
                username,
                email,
                password_hash: hash,
                age: ageNum,
                sexe: sexeStr,
                ville: villeStr,
                pays: paysStr
            }])
            .select()
            .single();

        if (error) {
            // Generic message — avoid leaking whether the email or username collided.
            return res.status(409).json({ error: 'Compte indisponible' });
        }

        res.json({ token: signToken(data), user: { id: data.id, username: data.username } });
    } catch (err) {
        console.error('register error:', err?.message || err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ── Connexion ────────────────────────────────────────────────────────────
// Generic 'Email ou mot de passe incorrect' on both 'unknown email' and
// 'wrong password' branches to prevent account enumeration. A dummy bcrypt
// compare runs even on unknown emails so timing is similar.
router.post('/login', async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password ?? '');

    if (!email || !password) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    try {
        const { data: user } = await supabase
            .from('users')
            .select('id, username, password_hash, is_banned')
            .eq('email', email)
            .maybeSingle();

        const dummyHash = '$2a$12$abcdefghijklmnopqrstuuMjPDx9LJjj9pUoFIvLWYJ8s5K1H1LOe';
        const ok = user
            ? await bcrypt.compare(password, user.password_hash)
            : (await bcrypt.compare(password, dummyHash), false);

        if (!user || !ok) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }
        if (user.is_banned) {
            return res.status(403).json({ error: 'Compte banni' });
        }

        res.json({ token: signToken(user), user: { id: user.id, username: user.username } });
    } catch (err) {
        console.error('login error:', err?.message || err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ── Connexion Google (Google Identity Services) ──────────────────────────
router.post('/google', async (req, res) => {
    const credential = req.body?.credential;
    if (!credential) return res.status(400).json({ error: 'Token Google manquant' });

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
        console.error('GOOGLE_CLIENT_ID env var not set');
        return res.status(500).json({ error: 'Service Google indisponible' });
    }

    try {
        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: googleClientId
        });
        const payload = ticket.getPayload();
        const email = normalizeEmail(payload?.email);
        const emailVerified = payload?.email_verified;
        const name = payload?.name || payload?.given_name || payload?.family_name || '';

        if (!email) return res.status(400).json({ error: 'Email Google introuvable' });
        if (!emailVerified) return res.status(403).json({ error: 'Email Google non vérifié' });

        const { data: existing, error: findErr } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        if (findErr) return res.status(500).json({ error: 'Erreur serveur' });

        let user = existing;
        if (!user) {
            const username = await ensureUniqueUsername(name || email.split('@')[0]);
            // We still store a password_hash since the column is NOT NULL.
            // The random value is unguessable and never used for /login because
            // it doesn't satisfy the strength rules above.
            const randomPw = `${payload?.sub || 'google'}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
            const hash = await bcrypt.hash(randomPw, BCRYPT_ROUNDS);

            const { data: created, error: createErr } = await supabase
                .from('users')
                .insert([{
                    username,
                    email,
                    password_hash: hash,
                    age: 18,
                    sexe: 'Autre',
                    ville: '—',
                    pays: '—'
                }])
                .select()
                .single();
            if (createErr) return res.status(400).json({ error: 'Impossible de créer le compte Google' });
            user = created;
        }

        if (user.is_banned) return res.status(403).json({ error: 'Compte banni' });

        res.json({ token: signToken(user), user: { id: user.id, username: user.username } });
    } catch (err) {
        console.error('google login error:', err?.message || err);
        res.status(400).json({ error: 'Token Google invalide' });
    }
});

module.exports = router;
