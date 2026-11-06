const express = require('express');
const { getPool } = require('../db/pool');
const router = express.Router();
const { getUserFromTokenReq } = require('./auth');
const { canAccessAchatPage, canAccessTab, validateAchatWritePermissions, filterRowsForRole, normalizeRole, canCreateAchat } = require('./permissions');
const { calculateAchatFields } = require('./achatCalculations');

const getVal = (obj, key) => (obj && obj[key] !== undefined ? obj[key] : null);

async function getAuthenticatedUser(req, res) {
  const user = await getUserFromTokenReq(req);
  if (!user) {
    res.status(401).json({ error: 'Non autorisé.' });
    return null;
  }
  return user;
}

// Colonnes metier (sans 'id', 'created_at', 'updated_at')
const COLUMN_KEYS = [
  'numero_da', 'date', 'date_reception_physique', 'filiale', 'departement_demandeur',
  'designation_demandee', 'designation_commandee', 'code_budget', 'montant_budget',
  'ecart_budget', 'statut_budget', 'mode_consultation', 'fournisseur_retenu',
  'fournisseurs_consultes', 'prix_reference', 'prix_unitaire', 'ecart_pourcentage',
  'quantite', 'unite', 'montant_ht', 'gain_achat', 'devise', 'type_paiement',
  'delai_paiement', 'statut_paiement', 'date_envoi_consultation', 'date_envoi_tco',
  'date_valid_filiale', 'date_valid_comite', 'pv_numero', 'num_bc', 'date_envoi_bc',
  'periode_bc', 'nb_bc', 'date_envoi_cdg', 'date_paiement', 'date_prevue_livraison', 'date_reception_facture',
  'numero_facture', 'bl', 'be', 'date_transmission',
  'statut', 'categorie_achat', 'acheteur', 'obs', 'cas_exceptionnel', 'action_requise', 'priorite',
  'budget_valide', 'immatriculation_vehicule', 'utilisateur_vehicule'
];
const DATE_KEYS = new Set([
  'date', 'date_reception_physique', 'date_envoi_consultation', 'date_envoi_tco',
  'date_valid_filiale', 'date_valid_comite', 'date_envoi_bc', 'date_envoi_cdg',
  'date_paiement', 'date_prevue_livraison', 'date_reception_facture', 'date_transmission'
]);

// Nettoyer les champs internes (ceux qui commencent par _)
function cleanRow(row) {
  if (!row || typeof row !== 'object') return row;
  const cleaned = {};
  for (const key of Object.keys(row)) {
    if (!key.startsWith('_')) {
      cleaned[key] = row[key];
    }
  }
  return cleaned;
}

function prepareBooleanValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['true', 't', '1', 'yes', 'y', 'oui', 'o'].includes(s)) return true;
  if (['false', 'f', '0', 'no', 'n', 'non'].includes(s)) return false;
  return null;
}

// ✅ VERSION CORRIGÉE : gère les objets Date natifs, formats variés, et valide strictement
function sanitizeDbValue(key, value) {
  if (value === '' || value === undefined || value === null) return null;

  if (DATE_KEYS.has(key)) {
    // Cas 1 : objet Date natif JS (retourné par PostgreSQL via le driver 'pg')
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        console.error(`Date invalide (Date object NaN): key=${key}`);
        throw Object.assign(new Error(`Date invalide pour le champ ${key}.`), { statusCode: 400 });
      }
      const y = value.getUTCFullYear();
      const m = value.getUTCMonth() + 1;
      const d = value.getUTCDate();
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    const text = String(value).trim();
    if (text === '') return null;

    let year, month, day;

    // Format ISO : YYYY-MM-DD (optionnellement suivi de T... ou espace)
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(text);
    if (match) {
      [, year, month, day] = match;
    } else {
      // Format JJ/MM/AAAA ou JJ.MM.AAAA ou JJ-MM-AAAA (ou variantes)
      match = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(text);
      if (match) {
        day = match[1];
        month = match[2];
        year = match[3].length === 2 ? `20${match[3]}` : match[3];
      }
    }

    year = Number(year);
    month = Number(month);
    day = Number(day);

    // Validation stricte (y compris les jours du mois, ex: 31/02 invalide)
    const parsedDate = new Date(Date.UTC(2000, 0, 1));
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      parsedDate.setUTCFullYear(year, month - 1, day);
    }

    const valid =
      Number.isInteger(year) && year >= 1 && year <= 9999 &&
      Number.isInteger(month) && month >= 1 && month <= 12 &&
      Number.isInteger(day) && day >= 1 && day <= 31 &&
      parsedDate.getUTCFullYear() === year &&
      parsedDate.getUTCMonth() === month - 1 &&
      parsedDate.getUTCDate() === day;

    if (!valid) {
      console.error(`Date invalide: key=${key}, value=`, value, `type=${typeof value}`);
      throw Object.assign(new Error(`Date invalide pour le champ ${key}.`), { statusCode: 400 });
    }

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Convert numeric NaN/Infinite to null to avoid PG errors
  if (typeof value === 'number') {
    if (!isFinite(value) || Number.isNaN(value)) return null;
    return value;
  }
  if (typeof value === 'string') {
    const tv = value.trim();
    if (tv === '') return null;
    if (tv.toLowerCase() === 'nan') return null;
    if (key === 'cas_exceptionnel' || key === 'budget_valide') {
      return prepareBooleanValue(tv);
    }
    const numericFields = ['montant_budget', 'ecart_budget', 'prix_reference', 'prix_unitaire',
                           'ecart_pourcentage', 'quantite', 'montant_ht', 'gain_achat'];
    if (numericFields.includes(key)) {
      const cleaned = tv.replace(/\s/g, '').replace(',', '.');
      const num = parseFloat(cleaned);
      return Number.isNaN(num) ? null : num;
    }
    return tv;
  }
  if (key === 'cas_exceptionnel' || key === 'budget_valide') {
    return prepareBooleanValue(value);
  }
  return value;
}

// ----- GET : lignes (supporte pagination via ?limit=&offset=) -----
router.get('/changes', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;

    const pool = await getPool();
    const role = normalizeRole(currentUser.role);
    const since = req.query.since ? new Date(String(req.query.since)) : new Date(0);
    if (Number.isNaN(since.getTime())) return res.status(400).json({ error: 'Date de synchronisation invalide.' });
    const syncUntil = new Date();

    let result;
    if (role === 'utilisateur' || role === 'achat') {
      const owners = Array.from(new Set([currentUser.identifier, currentUser.name]
        .filter(Boolean)
        .map(value => String(value).trim().toLowerCase())));
      result = await pool.query(
        'SELECT * FROM achats WHERE LOWER(TRIM(acheteur)) = ANY($1::text[]) AND updated_at > $2 AND updated_at <= $3 ORDER BY id',
        [owners, since.toISOString(), syncUntil.toISOString()]
      );
    } else {
      result = await pool.query(
        'SELECT * FROM achats WHERE updated_at > $1 AND updated_at <= $2 ORDER BY id',
        [since.toISOString(), syncUntil.toISOString()]
      );
    }

    return res.json({ rows: result.rows.map(row => calculateAchatFields({ ...row })), serverTime: syncUntil.toISOString() });
  } catch (err) {
    console.error('GET changes error:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;

    const pool = await getPool();
    const role = normalizeRole(currentUser.role);

    // pagination params
    const rawLimit = req.query.limit;
    const hasExplicitLimit = rawLimit !== undefined && rawLimit !== '' && String(rawLimit).toLowerCase() !== 'all';
    const defaultLimit = 500;
    const limit = hasExplicitLimit
      ? Math.min(10000, Math.max(1, parseInt(rawLimit, 10)))
      : defaultLimit;
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

    // Support explicite : limit=all renvoie la totalité des lignes.
    const shouldLoadAll = String(rawLimit || '').toLowerCase() === 'all';
    const effectiveLimit = shouldLoadAll ? null : limit;

    // simple filtering by owner for some roles
    let rowsQuery;
    let countQuery;
    if (role === 'utilisateur' || role === 'achat') {
      const owners = Array.from(new Set([currentUser.identifier, currentUser.name]
        .filter(Boolean)
        .map(value => String(value).trim().toLowerCase())));
      if (effectiveLimit !== null) {
        rowsQuery = pool.query('SELECT * FROM achats WHERE LOWER(TRIM(acheteur)) = ANY($1::text[]) ORDER BY id LIMIT $2 OFFSET $3', [owners, effectiveLimit, offset]);
      } else {
        rowsQuery = pool.query('SELECT * FROM achats WHERE LOWER(TRIM(acheteur)) = ANY($1::text[]) ORDER BY id OFFSET $2', [owners, offset]);
      }
      countQuery = pool.query('SELECT COUNT(*) AS cnt FROM achats WHERE LOWER(TRIM(acheteur)) = ANY($1::text[])', [owners]);
    } else {
      if (effectiveLimit !== null) {
        rowsQuery = pool.query('SELECT * FROM achats ORDER BY id LIMIT $1 OFFSET $2', [effectiveLimit, offset]);
      } else {
        rowsQuery = pool.query('SELECT * FROM achats ORDER BY id OFFSET $1', [offset]);
      }
      countQuery = pool.query('SELECT COUNT(*) AS cnt FROM achats');
    }

    const [rowsRes, countRes] = await Promise.all([rowsQuery, countQuery]);
    const total = countRes && countRes.rows && countRes.rows[0] ? parseInt(countRes.rows[0].cnt, 10) : 0;
    res.set('X-Total-Count', String(total));
    res.json(rowsRes.rows.map(row => calculateAchatFields({ ...row })));
  } catch (err) {
    console.error('GET error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// ----- POST : insérer une ou plusieurs lignes -----
router.post('/', async (req, res) => {
  try {
    let rows = req.body;
    if (!Array.isArray(rows)) rows = [rows];

    if (rows.length > 0 && !Array.isArray(rows[0]) && (typeof rows[0] !== 'object' || rows[0] === null)) {
      rows = [rows];
    }

    rows = rows.map(row => {
      if (Array.isArray(row)) {
        const obj = {};
        row.forEach((value, index) => {
          if (index === 0) return;
          const keyIndex = index - 1;
          if (keyIndex < COLUMN_KEYS.length) {
            obj[COLUMN_KEYS[keyIndex]] = value;
          }
        });
        return obj;
      }
      return row;
    });

    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;

    const role = normalizeRole(currentUser.role);
    if (!canCreateAchat(role)) {
      return res.status(403).json({ error: 'Ce rôle ne peut pas créer de dossier.' });
    }
    
    rows = rows.map(row => cleanRow(row));

    for (const row of rows) {
      const permissionCheck = validateAchatWritePermissions(role, row);
      if (!permissionCheck.ok) {
        return res.status(403).json({ error: permissionCheck.message });
      }
    }

    const owner = currentUser.name || currentUser.identifier;
    const ownerCandidates = Array.from(new Set([currentUser.name, currentUser.identifier].filter(Boolean)))
      .map(value => String(value).trim().toLowerCase());
    const insertOwner = currentUser.name || currentUser.identifier;
    rows = rows.map(row => {
      if (role === 'utilisateur' || role === 'achat') {
        return { ...row, acheteur: insertOwner };
      }
      if (!row.acheteur || row.acheteur === '') return { ...row, acheteur: insertOwner };
      return row;
    });

    rows = rows.filter(row => row != null && typeof row === 'object');
    rows = rows.filter(row => {
      const keys = Object.keys(row).filter(k => k !== 'id');
      return keys.some(k => row[k] !== null && row[k] !== undefined && row[k] !== '');
    });

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Aucune donnée valide à insérer.' });
    }

    const pool = await getPool();
    const client = await pool.connect();
    const inserted = [];

    const insertQuery = `
      INSERT INTO achats (
        numero_da, date, date_reception_physique, filiale, departement_demandeur,
        designation_demandee, designation_commandee, code_budget, montant_budget,
        ecart_budget, statut_budget, mode_consultation, fournisseur_retenu,
        fournisseurs_consultes, prix_reference, prix_unitaire, ecart_pourcentage,
        quantite, unite, montant_ht, gain_achat, devise, type_paiement,
        delai_paiement, statut_paiement, date_envoi_consultation, date_envoi_tco,
        date_valid_filiale, date_valid_comite, pv_numero, num_bc, date_envoi_bc,
        periode_bc, nb_bc, date_envoi_cdg, date_paiement, date_prevue_livraison,
        date_reception_facture, numero_facture, bl, be, date_transmission,
        statut, categorie_achat, acheteur, obs, cas_exceptionnel, action_requise, priorite,
        budget_valide, immatriculation_vehicule, utilisateur_vehicule
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
        $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
        $51, $52
      ) RETURNING *;
    `;

    try {
      await client.query('BEGIN');
      for (const row of rows) {
        row.cas_exceptionnel = prepareBooleanValue(row.cas_exceptionnel);
        row.budget_valide = prepareBooleanValue(row.budget_valide);
        calculateAchatFields(row);
        const values = COLUMN_KEYS.map(key => sanitizeDbValue(key, getVal(row, key)));
        const result = await client.query(insertQuery, values);
        inserted.push(result.rows[0]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json(inserted);
  } catch (err) {
    console.error('POST error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// ----- PUT (batch) : mettre à jour et insérer en lot -----
router.put('/batch', async (req, res) => {
  try {
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;

    let inserts = Array.isArray(req.body.inserts) ? req.body.inserts : [];
    let updates = Array.isArray(req.body.updates) ? req.body.updates : [];

    // Normalize shapes
    inserts = inserts.map(r => (Array.isArray(r) ? null : r)).filter(Boolean);
    updates = updates.map(u => ({ id: u && u.id ? parseInt(u.id, 10) : null, row: u && u.row ? u.row : null })).filter(u => u.id && u.row);

    if (inserts.length === 0 && updates.length === 0) {
      return res.status(400).json({ error: 'Aucune donnée à traiter.' });
    }

    const role = normalizeRole(currentUser.role);
    if (inserts.length > 0 && !canCreateAchat(role)) {
      return res.status(403).json({ error: 'Ce rôle ne peut pas créer de dossier.' });
    }

    inserts = inserts.map(row => cleanRow(row));
    for (const row of inserts) {
      const permissionCheck = validateAchatWritePermissions(role, row);
      if (!permissionCheck.ok) {
        return res.status(403).json({ error: permissionCheck.message });
      }
    }

    const pool = await getPool();
    const client = await pool.connect();

    const owner = currentUser.name || currentUser.identifier;
    const ownerCandidates = Array.from(new Set([currentUser.name, currentUser.identifier].filter(Boolean)))
      .map(value => String(value).trim().toLowerCase());
    const insertOwner = currentUser.name || currentUser.identifier;

    const inserted = [];
    const updated = [];

    const insertQuery = `
      INSERT INTO achats (
        numero_da, date, date_reception_physique, filiale, departement_demandeur,
        designation_demandee, designation_commandee, code_budget, montant_budget,
        ecart_budget, statut_budget, mode_consultation, fournisseur_retenu,
        fournisseurs_consultes, prix_reference, prix_unitaire, ecart_pourcentage,
        quantite, unite, montant_ht, gain_achat, devise, type_paiement,
        delai_paiement, statut_paiement, date_envoi_consultation, date_envoi_tco,
        date_valid_filiale, date_valid_comite, pv_numero, num_bc, date_envoi_bc,
        periode_bc, nb_bc, date_envoi_cdg, date_paiement, date_prevue_livraison,
        date_reception_facture, numero_facture, bl, be, date_transmission,
        statut, categorie_achat, acheteur, obs, cas_exceptionnel, action_requise, priorite,
        budget_valide, immatriculation_vehicule, utilisateur_vehicule
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
        $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
        $51, $52
      ) RETURNING *;
    `;

    const updateFields = COLUMN_KEYS.map((key, index) => `${key} = $${index + 1}`);
    const updateQuery = `
      UPDATE achats SET
        ${updateFields.join(', ')},
        updated_at = NOW()
      WHERE id = $${COLUMN_KEYS.length + 1}
      RETURNING *;
    `;

    try {
      await client.query('BEGIN');

      // Process inserts
      for (const row of inserts) {
        const allowDuplicateNumeroDa = row && row._allowDuplicateNumeroDa === true;
        const r = row;
        if (role === 'utilisateur' || role === 'achat' || !r.acheteur || r.acheteur === '') r.acheteur = insertOwner;
        const numeroDa = r.numero_da === undefined || r.numero_da === null ? '' : String(r.numero_da).trim();
        if (numeroDa !== '' && !allowDuplicateNumeroDa) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [numeroDa.toLowerCase()]);
          const existingInsert = await client.query('SELECT * FROM achats WHERE LOWER(TRIM(numero_da)) = LOWER(TRIM($1)) ORDER BY id LIMIT 1', [numeroDa]);
          if (existingInsert.rows[0]) {
            inserted.push(existingInsert.rows[0]);
            continue;
          }
        }
        r.cas_exceptionnel = prepareBooleanValue(r.cas_exceptionnel);
        r.budget_valide = prepareBooleanValue(r.budget_valide);
        calculateAchatFields(r);
        const values = COLUMN_KEYS.map(key => sanitizeDbValue(key, getVal(r, key)));
        const resIns = await client.query(insertQuery, values);
        inserted.push(resIns.rows[0]);
      }

      // Preload existing rows for updates
      const ids = updates.map(u => u.id);
      const existingRowsRes = ids.length ? await client.query('SELECT * FROM achats WHERE id = ANY($1::int[])', [ids]) : { rows: [] };
      const existingMap = {};
      existingRowsRes.rows.forEach(r => { existingMap[r.id] = r; });

      for (const upd of updates) {
        const existing = existingMap[upd.id];
        if (!existing) {
          throw Object.assign(new Error('Ligne non trouvée.'), { statusCode: 404 });
        }

        if ((role === 'utilisateur' || role === 'achat') && !ownerCandidates.includes(String(existing.acheteur || '').trim().toLowerCase())) {
          throw Object.assign(new Error('Vous ne pouvez modifier que vos propres dossiers.'), { statusCode: 403 });
        }

        const permissionCheck = validateAchatWritePermissions(role, upd.row, existing);
        if (!permissionCheck.ok) {
          throw Object.assign(new Error(permissionCheck.message), { statusCode: 403 });
        }

        const rowToUpdate = { ...existing, ...(upd.row || {}) };
        const BOOL_KEYS = ['cas_exceptionnel', 'budget_valide'];
        for (const b of BOOL_KEYS) {
          rowToUpdate[b] = prepareBooleanValue(rowToUpdate[b]);
        }

        if (role === 'cdg') {
          if (Object.prototype.hasOwnProperty.call(upd.row, 'montant_budget') && String(existing.pv_numero || '').trim() === '') {
            delete upd.row.montant_budget;
          }
          const allowedFields = ['code_budget', 'montant_budget', 'montant_ht', 'ecart_budget', 'statut_budget', 'ecart_pourcentage', 'gain_achat'];
          const filteredRow = {};
          allowedFields.forEach(field => { if (upd.row[field] !== undefined) filteredRow[field] = upd.row[field]; });
          Object.assign(rowToUpdate, filteredRow);
        }
        if (role === 'back_office') {
          const allowedFields = ['num_bc', 'date_envoi_bc', 'immatriculation_vehicule', 'utilisateur_vehicule',
                                'periode_bc', 'nb_bc', 'date_envoi_cdg', 
                                'date_paiement', 'date_prevue_livraison', 'date_reception_facture', 'numero_facture',
                                'bl', 'be', 'date_transmission', 'statut', 'categorie_achat',
                                'obs', 'cas_exceptionnel', 'action_requise', 'priorite', 'budget_valide'];
          const filteredRow = {};
          allowedFields.forEach(field => { if (upd.row[field] !== undefined) filteredRow[field] = upd.row[field]; });
          Object.assign(rowToUpdate, filteredRow);
        }

        calculateAchatFields(rowToUpdate);
        const values = COLUMN_KEYS.map(key => sanitizeDbValue(key, rowToUpdate[key]));
        values.push(upd.id);
        const resUpd = await client.query(updateQuery, values);
        if (resUpd && resUpd.rows && resUpd.rows[0]) updated.push(resUpd.rows[0]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ inserted, updated });
  } catch (err) {
    console.error('BATCH PUT error:', err);
    const statusCode = Number.isInteger(err.statusCode) ? err.statusCode : 500;
    res.status(statusCode).json({ error: statusCode === 500 ? 'Erreur interne du serveur.' : err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'ID invalide' });
    }
    let row = req.body;

    // Si row est un tableau (cas du front-end), le convertir en objet
    if (Array.isArray(row) && !row.some(v => typeof v === 'object' && v !== null)) {
      const obj = {};
      row.forEach((value, index) => {
        if (index === 0) return;
        const keyIndex = index - 1;
        if (keyIndex < COLUMN_KEYS.length) {
          obj[COLUMN_KEYS[keyIndex]] = value;
        }
      });
      row = obj;
    }

    // Nettoyer les champs internes
    row = cleanRow(row);

    if (!row || typeof row !== 'object') {
      return res.status(400).json({ error: 'Données invalides' });
    }

    const pool = await getPool();
    const client = await pool.connect();
    let result;
    try {
      const existingResult = await client.query('SELECT * FROM achats WHERE id = $1', [id]);
      if (existingResult.rowCount === 0) {
        return res.status(404).json({ error: 'Ligne non trouvée' });
      }
      const existingRow = existingResult.rows[0];
      const existingAcheteur = existingRow.acheteur;
      const role = normalizeRole(currentUser.role);
      const ownerCandidates = Array.from(new Set([currentUser.name, currentUser.identifier]
        .filter(Boolean)
        .map(value => String(value).trim().toLowerCase())));
      
      if ((role === 'utilisateur' || role === 'achat') && !ownerCandidates.includes(String(existingAcheteur || '').trim().toLowerCase())) {
        return res.status(403).json({ error: 'Accès refusé : vous ne pouvez modifier que vos propres dossiers.' });
      }
      
      const permissionCheck = validateAchatWritePermissions(role, row, existingRow);
      if (!permissionCheck.ok) {
        return res.status(403).json({ error: permissionCheck.message });
      }

      // Fusionner les données existantes avec les nouvelles
      const rowToUpdate = { ...existingRow, ...row };

      // Coerce boolean-like values
      const BOOL_KEYS = ['cas_exceptionnel', 'budget_valide'];
      for (const b of BOOL_KEYS) {
        let v = rowToUpdate[b];
        if (v === undefined || v === null || v === '') {
          rowToUpdate[b] = null;
        } else if (typeof v === 'boolean') {
          // ok
        } else {
          const s = String(v).trim().toLowerCase();
          if (['true', 't', '1', 'yes', 'y', 'oui', 'o'].includes(s)) rowToUpdate[b] = true;
          else if (['false', 'f', '0', 'no', 'n', 'non'].includes(s)) rowToUpdate[b] = false;
          else rowToUpdate[b] = null;
        }
      }

      // Pour CDG : on ne permet que la modification de code_budget et montant_budget,
      // mais on accepte aussi les champs calculés qui doivent être persistés.
      if (role === 'cdg') {
        if (Object.prototype.hasOwnProperty.call(row, 'montant_budget') && String(existingRow.pv_numero || '').trim() === '') {
          delete row.montant_budget;
        }
        const allowedFields = ['code_budget', 'montant_budget', 'montant_ht', 'ecart_budget', 'statut_budget', 'ecart_pourcentage', 'gain_achat'];
        const filteredRow = {};
        allowedFields.forEach(field => {
          if (row[field] !== undefined) {
            filteredRow[field] = row[field];
          }
        });
        Object.assign(rowToUpdate, filteredRow);
      }

      // Pour Back Office : on ne permet que certains champs
      if (role === 'back_office') {
        const allowedFields = ['num_bc', 'date_envoi_bc', 'immatriculation_vehicule', 'utilisateur_vehicule',
                              'periode_bc', 'nb_bc', 'date_envoi_cdg', 
                              'date_paiement', 'date_prevue_livraison', 'date_reception_facture', 'numero_facture',
                              'bl', 'be', 'date_transmission', 'statut', 'categorie_achat',
                              'obs', 'cas_exceptionnel', 'action_requise', 'priorite', 'budget_valide'];
        const filteredRow = {};
        allowedFields.forEach(field => {
          if (row[field] !== undefined) {
            filteredRow[field] = row[field];
          }
        });
        Object.assign(rowToUpdate, filteredRow);
      }

      calculateAchatFields(rowToUpdate);
      // Construire la requête UPDATE optimisée
      const updateFields = COLUMN_KEYS.map((key, index) => `${key} = $${index + 1}`);
      const updateQuery = `
        UPDATE achats SET
          ${updateFields.join(', ')},
          updated_at = NOW()
        WHERE id = $${COLUMN_KEYS.length + 1}
        RETURNING *;
      `;

      const values = COLUMN_KEYS.map(key => sanitizeDbValue(key, rowToUpdate[key]));
      values.push(id);

      result = await client.query(updateQuery, values);
      
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Ligne non trouvée' });
      }
    } finally {
      client.release();
    }
  
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// ----- DELETE -----
router.delete('/:id', async (req, res) => {
  try {
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID invalide' });
    const pool = await getPool();
    const client = await pool.connect();
    const role = normalizeRole(currentUser.role);

    try {
      if (role === 'back_office') {
        return res.status(403).json({ error: 'Le rôle back office ne peut pas supprimer des lignes.' });
      }

      let result;
      if (role === 'utilisateur' || role === 'achat') {
        const ownerCandidates = Array.from(new Set([currentUser.name, currentUser.identifier]
          .filter(Boolean)
          .map(value => String(value).trim().toLowerCase())));
        result = await client.query('DELETE FROM achats WHERE id = $1 AND LOWER(TRIM(acheteur)) = ANY($2::text[]) RETURNING id', [id, ownerCandidates]);
      } else {
        result = await client.query('DELETE FROM achats WHERE id = $1 RETURNING id', [id]);
      }
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Ligne non trouvée ou accès refusé.' });
      }
      res.json({ deleted: result.rows[0].id });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('DELETE error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// ----- DELETE (batch) : suppression en lot -----
router.delete('/', async (req, res) => {
  try {
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;

    let ids = [];
    if (Array.isArray(req.body)) ids = req.body;
    else if (req.body && Array.isArray(req.body.ids)) ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Aucun id fourni pour suppression.' });
    }

    const pool = await getPool();
    const client = await pool.connect();
    const role = normalizeRole(currentUser.role);

    try {
      if (role === 'back_office') {
        return res.status(403).json({ error: 'Le rôle back office ne peut pas supprimer des lignes.' });
      }

      let result;
      if (role === 'utilisateur' || role === 'achat') {
        const ownerCandidates = Array.from(new Set([currentUser.name, currentUser.identifier]
          .filter(Boolean)
          .map(value => String(value).trim().toLowerCase())));
        result = await client.query('DELETE FROM achats WHERE id = ANY($1::int[]) AND LOWER(TRIM(acheteur)) = ANY($2::text[]) RETURNING id', [ids, ownerCandidates]);
      } else {
        result = await client.query('DELETE FROM achats WHERE id = ANY($1::int[]) RETURNING id', [ids]);
      }
      res.json({ deleted: result.rows.map(r => r.id), count: result.rowCount });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('BATCH DELETE error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});



module.exports = router;

// ----- POST : resequence / renumérotation des IDs (ADMIN seulement) -----
router.post('/resequence', async (req, res) => {
  try {
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;
    const role = normalizeRole(currentUser.role);
    if (role !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé : seul le rôle admin peut réindexer les IDs.' });
    }

    const pool = await getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("LOCK TABLE achats IN ACCESS EXCLUSIVE MODE");

      const colsRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='achats' AND column_name <> 'id' ORDER BY ordinal_position");
      const cols = colsRes.rows.map(r => '"' + r.column_name + '"').join(', ');

      await client.query(`CREATE TABLE achats_reseq AS SELECT row_number() OVER (ORDER BY id) AS id, ${cols} FROM achats ORDER BY id`);

      await client.query('DROP TABLE achats');
      await client.query('ALTER TABLE achats_reseq RENAME TO achats');

      await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind='S' AND relname='achats_id_seq') THEN CREATE SEQUENCE achats_id_seq; END IF; END $$;");
      await client.query("ALTER SEQUENCE achats_id_seq OWNED BY achats.id");
      await client.query("ALTER TABLE achats ALTER COLUMN id SET DEFAULT nextval('achats_id_seq')");
      await client.query("SELECT setval('achats_id_seq', COALESCE((SELECT MAX(id) FROM achats), 0))");
      await client.query('ALTER TABLE achats ADD PRIMARY KEY (id)');

      await client.query('COMMIT');
      const maxRes = await client.query('SELECT COALESCE(MAX(id),0) AS max FROM achats');
      client.release();
      res.json({ ok: true, max_id: maxRes.rows[0].max });
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      console.error('RESEQUENCE error:', err);
      res.status(500).json({ error: 'Erreur interne du serveur.' });
    }
  } catch (err) {
    console.error('RESEQUENCE outer error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});