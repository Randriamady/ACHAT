const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { getUserFromTokenReq } = require('./auth');
const { normalizeRole } = require('./permissions');

async function requireAdmin(req, res) {
  const currentUser = await getUserFromTokenReq(req);
  if (!currentUser) {
    res.status(401).json({ ok: false, message: 'Non autorisé.' });
    return null;
  }
  if (normalizeRole(currentUser.role) !== 'admin') {
    res.status(403).json({ ok: false, message: 'Accès réservé aux administrateurs.' });
    return null;
  }
  return currentUser;
}

function mapUser(row) {
  return {
    id: row.id,
    identifier: row.identifier,
    username: row.identifier,
    full_name: row.name || row.identifier,
    name: row.name || row.identifier,
    email: null,
    role: row.role || 'user',
    is_active: row.is_active !== false,
    department: '—',
    last_login: row.updated_at || row.created_at,
    doc_count: 0,
    avatar_color: ['#2563eb', '#7c3aed', '#10b981', '#f59e0b', '#ef4444'][row.id % 5],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

router.get('/', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const result = await query(
      `SELECT id, identifier, name, role, is_active, created_at, updated_at FROM users ORDER BY name, identifier`
    );
    return res.json(result.rows.map(mapUser));
  } catch (err) {
    console.error('Erreur users list:', err.message);
    return res.status(500).json({ ok: false, message: 'Erreur serveur lors du chargement des utilisateurs.' });
  }
});

router.patch('/:id/toggle-active', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ ok: false, message: 'Identifiant utilisateur invalide.' });
  }

  try {
    const current = await query('SELECT id, is_active FROM users WHERE id = $1', [id]);
    if (current.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Utilisateur introuvable.' });
    }

    const nextValue = !Boolean(current.rows[0].is_active);
    await query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2', [nextValue, id]);
    const updated = await query('SELECT id, identifier, name, role, is_active, created_at, updated_at FROM users WHERE id = $1', [id]);

    return res.json({ ok: true, user: mapUser(updated.rows[0]) });
  } catch (err) {
    console.error('Erreur toggle user:', err.message);
    return res.status(500).json({ ok: false, message: 'Erreur serveur lors du changement de statut.' });
  }
});

router.delete('/:id', async (req, res) => {
  const currentUser = await getUserFromTokenReq(req);
  if (!currentUser) {
    return res.status(401).json({ ok: false, message: 'Non autorisé.' });
  }
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ ok: false, message: 'Accès refusé : réservé aux administrateurs.' });
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ ok: false, message: 'Identifiant utilisateur invalide.' });
  }
  if (id === currentUser.id) {
    return res.status(400).json({ ok: false, message: 'Impossible de supprimer votre propre compte.' });
  }

  try {
    const existing = await query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Utilisateur introuvable.' });
    }
    await query('DELETE FROM users WHERE id = $1', [id]);
    return res.json({ ok: true, deleted: id });
  } catch (err) {
    console.error('Erreur suppression user:', err.message);
    return res.status(500).json({ ok: false, message: 'Erreur serveur lors de la suppression de l’utilisateur.' });
  }
});

module.exports = router;
