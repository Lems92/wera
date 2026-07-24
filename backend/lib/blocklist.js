const supabase = require('../config/supabase');

// Paires d'utilisateurs à ne JAMAIS réapparier (signaleur ↔ signalé).
// Voir docs/SIGNALEMENT.md §2 : le blocage est implicite et définitif dès
// le signalement. Chargée depuis la table reports au boot, tenue à jour en
// mémoire à chaque nouveau signalement. Le serveur tourne en instance
// unique (Render), donc l'état en mémoire fait foi entre deux boots.
const pairs = new Set();

const key = (a, b) => (String(a) < String(b) ? a + '|' + b : b + '|' + a);

async function load() {
    try {
        const { data, error } = await supabase
            .from('reports')
            .select('reporter_id, reported_id')
            .limit(10000);
        if (error) throw new Error(error.message);
        (data || []).forEach((r) => {
            if (r.reporter_id && r.reported_id) pairs.add(key(r.reporter_id, r.reported_id));
        });
        console.log(`🚫 Blocklist matchmaking chargée: ${pairs.size} paire(s)`);
    } catch (e) {
        console.warn('blocklist load:', e.message || e);
    }
}

module.exports = {
    load,
    block: (a, b) => { if (a && b) pairs.add(key(a, b)); },
    isBlocked: (a, b) => pairs.has(key(a, b))
};
