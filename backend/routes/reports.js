const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/authMiddleware');

router.post('/', auth, async (req, res) => {
    const { reported_id, reason } = req.body;

    const { error } = await supabase
        .from('reports')
        .insert([{ reporter_id: req.user.id, reported_id, reason }]);

    if (error) return res.status(500).json({ error: 'Erreur signalement' });

    res.json({ message: 'Signalement envoyé' });
});

module.exports = router;