const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');

// ── Admins de la console de modération ──────────────────────────────────
// Deux sources, cumulables :
//   1. ADMIN_USER_IDS  — ids utilisateurs séparés par des virgules.
//   2. ADMIN_EMAIL (+ ADMIN_PASSWORD) — « admin par défaut » : au boot, si
//      aucun compte n'existe avec cet e-mail, il est créé avec ce mot de
//      passe ; dans tous les cas son id devient admin.
// Aucun identifiant n'est codé en dur : un mot de passe par défaut dans le
// code serait une porte d'entrée publique.
const ids = new Set(
    String(process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
);

async function init() {
    const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    if (!email) {
        if (!ids.size) console.warn('👑 Console modération: aucun admin configuré (ADMIN_EMAIL+ADMIN_PASSWORD ou ADMIN_USER_IDS)');
        return;
    }

    try {
        const { data: existing } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .maybeSingle();

        let adminId = existing?.id || null;

        if (!adminId) {
            if (!password) {
                console.warn('👑 ADMIN_EMAIL défini mais ADMIN_PASSWORD manquant — admin par défaut non créé');
                return;
            }
            const hash = await bcrypt.hash(password, 12);
            const base = {
                email,
                password_hash: hash,
                age: 30,
                sexe: 'Autre',
                ville: '—',
                pays: 'Madagascar'
            };
            let { data: created, error } = await supabase
                .from('users')
                .insert([{ ...base, username: 'admin' }])
                .select('id')
                .single();
            if (error && error.code === '23505') {
                // « admin » déjà pris par quelqu'un d'autre — suffixe aléatoire.
                ({ data: created, error } = await supabase
                    .from('users')
                    .insert([{ ...base, username: 'admin_' + Math.random().toString(36).slice(2, 7) }])
                    .select('id')
                    .single());
            }
            if (error) {
                console.warn('👑 Création admin par défaut impossible:', error.message);
                return;
            }
            adminId = created.id;
            console.log(`👑 Admin par défaut créé (${email})`);
        }

        ids.add(adminId);
        console.log(`👑 Console modération: ${ids.size} admin(s) actif(s)`);
    } catch (e) {
        console.warn('👑 init admins:', e?.message || e);
    }
}

module.exports = {
    init,
    isAdmin: (userId) => ids.has(userId),
    count: () => ids.size
};
