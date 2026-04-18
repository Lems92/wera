const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

// Inscription
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password)
        return res.status(400).json({ error: 'Champs manquants' });

    try {
        const hash = await bcrypt.hash(password, 10);
        const { data, error } = await supabase
            .from('users')
            .insert([{ username, email, password_hash: hash }])
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

module.exports = router;