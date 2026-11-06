const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const { query } = require('../db/pool');
const { getUserFromTokenReq } = require('./auth');
const { normalizeRole } = require('./permissions');

async function getAuthenticatedUser(req, res) {
  const user = await getUserFromTokenReq(req);
  if (!user) {
    res.status(401).json({ ok: false, message: 'Non autorisé.' });
    return null;
  }
  return user;
}

async function getAdminUser(req, res) {
  const user = await getAuthenticatedUser(req, res);
  if (!user) return null;
  if (normalizeRole(user.role) !== 'admin') {
    res.status(403).json({ ok: false, message: 'Accès réservé aux administrateurs.' });
    return null;
  }
  return user;
}

router.get('/config', async (req, res) => {
  const user = await getAuthenticatedUser(req, res);
  if (!user) return;

  try {
    const result = await query(
      `SELECT sheet_key, name, owner_name, is_enabled, visible_user_ids, show_empty_rows
       FROM achat_sheet_settings
       ORDER BY CASE sheet_key
         WHEN 'colonne_gaelle' THEN 1
         WHEN 'colonne_jeannie' THEN 2
         WHEN 'colonne_raissa' THEN 3
         WHEN 'colonne_ando' THEN 4
         WHEN 'attente_comite' THEN 6
         WHEN 'valide_comite' THEN 7
         WHEN 'tous' THEN 8
         WHEN 'livre' THEN 9
         WHEN 'colonne' THEN 10
         ELSE CASE WHEN owner_name IS NOT NULL THEN 5 ELSE 11 END
       END`
    );
    return res.json({
      ok: true,
      sheets: result.rows.map((sheet) => ({
        key: sheet.sheet_key,
        name: sheet.name,
        ownerName: sheet.owner_name,
        enabled: sheet.is_enabled,
        showEmptyRows: sheet.show_empty_rows,
        visible: sheet.is_enabled && (
          sheet.visible_user_ids === null ||
          sheet.visible_user_ids.map(Number).includes(Number(user.id))
        )
      }))
    });
  } catch (err) {
    console.error('Erreur chargement des paramètres des feuilles:', err.message);
    return res.status(500).json({ ok: false, message: 'Erreur serveur lors du chargement des feuilles.' });
  }
});

router.get('/admin', async (req, res) => {
  if (!await getAdminUser(req, res)) return;

  try {
    const [sheets, users] = await Promise.all([
      query(
        `SELECT sheet_key, name, owner_name, is_enabled, visible_user_ids
         FROM achat_sheet_settings
         WHERE sheet_key <> 'colonne'
         ORDER BY CASE sheet_key
           WHEN 'colonne_gaelle' THEN 1
           WHEN 'colonne_jeannie' THEN 2
           WHEN 'colonne_raissa' THEN 3
           WHEN 'colonne_ando' THEN 4
           WHEN 'attente_comite' THEN 6
           WHEN 'valide_comite' THEN 7
           WHEN 'tous' THEN 8
           WHEN 'livre' THEN 9
           ELSE CASE WHEN owner_name IS NOT NULL THEN 5 ELSE 10 END
         END, name`
      ),
      query('SELECT id, identifier, name, is_active FROM users ORDER BY name, identifier')
    ]);

    return res.json({
      ok: true,
      sheets: sheets.rows.map((sheet) => ({
        key: sheet.sheet_key,
        name: sheet.name,
        ownerName: sheet.owner_name,
        enabled: sheet.is_enabled,
        visibleUserIds: sheet.visible_user_ids === null
          ? null
          : sheet.visible_user_ids.map(Number)
      })),
      users: users.rows.map((user) => ({
        id: user.id,
        identifier: user.identifier,
        name: user.name || user.identifier,
        isActive: user.is_active
      }))
    });
  } catch (err) {
    console.error('Erreur chargement admin des feuilles:', err.message);
    return res.status(500).json({ ok: false, message: 'Erreur serveur lors du chargement des feuilles.' });
  }
});

router.post('/admin', async (req, res) => {
  if (!await getAdminUser(req, res)) return;

  const ownerName = typeof req.body?.ownerName === 'string' ? req.body.ownerName.trim() : '';
  if (!ownerName || ownerName.length > 80) {
    return res.status(400).json({ ok: false, message: 'Le nom de l’acheteur doit contenir entre 1 et 80 caractères.' });
  }

  try {
    const duplicate = await query(
      `SELECT 1 FROM achat_sheet_settings
       WHERE LOWER(TRIM(COALESCE(owner_name, ''))) = LOWER($1)
          OR (owner_name IS NULL AND LOWER(TRIM(name)) = LOWER($1))
       LIMIT 1`,
      [ownerName]
    );
    if (duplicate.rowCount > 0) {
      return res.status(409).json({ ok: false, message: 'Une feuille existe déjà pour cet acheteur.' });
    }

    const sheetKey = `colonne_${randomUUID()}`;
    const created = await query(
      `INSERT INTO achat_sheet_settings (sheet_key, name, owner_name, is_enabled, visible_user_ids, show_empty_rows)
       VALUES ($1, $2, $2, TRUE, NULL, TRUE)
       RETURNING sheet_key, name, owner_name, is_enabled, visible_user_ids`,
      [sheetKey, ownerName]
    );
    const sheet = created.rows[0];
    return res.status(201).json({
      ok: true,
      sheet: {
        key: sheet.sheet_key,
        name: sheet.name,
        ownerName: sheet.owner_name,
        enabled: sheet.is_enabled,
        visibleUserIds: sheet.visible_user_ids
      }
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, message: 'Une feuille existe déjà pour cet acheteur.' });
    }
    console.error('Erreur création d’une feuille acheteur:', err.message);
    return res.status(500).json({ ok: false, message: 'Erreur serveur lors de la création de la feuille.' });
  }
});

router.put('/admin/:key', async (req, res) => {
  if (!await getAdminUser(req, res)) return;

  const sheetKey = String(req.params.key || '');
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const enabled = req.body?.enabled;
  const requestedUserIds = req.body?.visibleUserIds;

  if (!name || name.length > 80) {
    return res.status(400).json({ ok: false, message: 'Le nom doit contenir entre 1 et 80 caractères.' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ ok: false, message: 'Le statut de la feuille est invalide.' });
  }
  if (requestedUserIds !== null && !Array.isArray(requestedUserIds)) {
    return res.status(400).json({ ok: false, message: 'La liste des utilisateurs est invalide.' });
  }

  let visibleUserIds = null;
  if (requestedUserIds !== null) {
    visibleUserIds = [...new Set(requestedUserIds.map(Number))];
    if (visibleUserIds.some((id) => !Number.isInteger(id) || id < 1)) {
      return res.status(400).json({ ok: false, message: 'La liste des utilisateurs est invalide.' });
    }
  }

  try {
    const [currentSheets, users, requestedUsers] = await Promise.all([
      query('SELECT sheet_key, is_enabled, visible_user_ids FROM achat_sheet_settings'),
      query('SELECT id FROM users'),
      visibleUserIds?.length
        ? query('SELECT id FROM users WHERE id = ANY($1::int[])', [visibleUserIds])
        : Promise.resolve({ rows: [] })
    ]);

    const existing = currentSheets.rows.find((sheet) => sheet.sheet_key === sheetKey);
    if (!existing) {
      return res.status(404).json({ ok: false, message: 'Feuille introuvable.' });
    }
    if (visibleUserIds && requestedUsers.rows.length !== visibleUserIds.length) {
      return res.status(400).json({ ok: false, message: 'Un ou plusieurs utilisateurs sont introuvables.' });
    }

    const proposedSheets = currentSheets.rows.map((sheet) => sheet.sheet_key === sheetKey
      ? { sheet_key: sheetKey, is_enabled: enabled, visible_user_ids: visibleUserIds }
      : sheet);
    const leavesWithoutSheet = users.rows.some((user) => !proposedSheets.some((sheet) => (
      sheet.is_enabled && (
        sheet.visible_user_ids === null ||
        sheet.visible_user_ids.map(Number).includes(Number(user.id))
      )
    )));
    if (leavesWithoutSheet) {
      return res.status(400).json({
        ok: false,
        message: 'Chaque utilisateur doit conserver au moins une feuille visible.'
      });
    }

    const updated = await query(
      `UPDATE achat_sheet_settings
       SET name = $1, is_enabled = $2, visible_user_ids = $3::jsonb, updated_at = NOW()
       WHERE sheet_key = $4
       RETURNING sheet_key, name, is_enabled, visible_user_ids`,
      [name, enabled, visibleUserIds === null ? null : JSON.stringify(visibleUserIds), sheetKey]
    );

    const sheet = updated.rows[0];
    return res.json({
      ok: true,
      sheet: {
        key: sheet.sheet_key,
        name: sheet.name,
        enabled: sheet.is_enabled,
        visibleUserIds: sheet.visible_user_ids === null
          ? null
          : sheet.visible_user_ids.map(Number)
      }
    });
  } catch (err) {
    console.error('Erreur mise à jour des paramètres d’une feuille:', err.message);
    return res.status(500).json({ ok: false, message: 'Erreur serveur lors de la mise à jour de la feuille.' });
  }
});

module.exports = router;
