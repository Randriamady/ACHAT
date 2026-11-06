const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const XLSX = require('xlsx');
const { getPool } = require('../db/pool');
const router = express.Router();
const { getUserFromTokenReq } = require('./auth');
const { normalizeRole } = require('./permissions');
const { calculateAchatFields } = require('./achatCalculations');

const WINDOWS_IMPORT_FOLDER_PATH = '\\\\192.168.20.204\\partage-sipromad\\PARTAGE-ACHAT\\REPORTING_ACHAT_LOCAL\\ACHAT';
const IMPORT_FOLDER_PATH = process.env.IMPORT_FOLDER_PATH
  || (process.platform === 'win32' ? WINDOWS_IMPORT_FOLDER_PATH : '/mnt/partage-achat');

// ============================================================
// FONCTIONS UTILITAIRES
// ============================================================

async function getAuthenticatedUser(req, res) {
  const user = await getUserFromTokenReq(req);
  if (!user) {
    res.status(401).json({ error: 'Non autorisé.' });
    return null;
  }
  return user;
}

// Mapping des colonnes Excel vers la base de données
const EXCEL_COLUMN_MAPPING = {
  'N° DA': 'numero_da',
  'Date': 'date',
  'Date de reception physique': 'date_reception_physique',
  'Filiale': 'filiale',
  'Dpt. Demandeur': 'departement_demandeur',
  'Désignation Demandée': 'designation_demandee',
  'Désignation Commandée': 'designation_commandee',
  'Code Budget': 'code_budget',
  'Montant Budget': 'montant_budget',
  'Écart Budget': 'ecart_budget',
  'Statut Budget': 'statut_budget',
  'Mode de Consultation': 'mode_consultation',
  'Fournisseur Retenu': 'fournisseur_retenu',
  'Fournisseurs Consultés': 'fournisseurs_consultes',
  'Prix de Référence': 'prix_reference',
  'Prix Unitaire': 'prix_unitaire',
  'Écart (%)': 'ecart_pourcentage',
  'Qté': 'quantite',
  'Unité': 'unite',
  'Montant HT': 'montant_ht',
  'GAIN Achat': 'gain_achat',
  'Devise': 'devise',
  'Type de Paiement': 'type_paiement',
  'Délai Paiement': 'delai_paiement',
  'Statut Paiement': 'statut_paiement',
  'Date Envoi Consultation': 'date_envoi_consultation',
  'Date Envoi TCO': 'date_envoi_tco',
  'Date Valid. Filiale': 'date_valid_filiale',
  'Date Valid. Comité': 'date_valid_comite',
  'PV N°': 'pv_numero',
  'N° BC': 'num_bc',
  'Date Envoi BC': 'date_envoi_bc',
  'Immatriculation du véhicule': 'immatriculation_vehicule',
  'Utilisateur du véhicule': 'utilisateur_vehicule',
  'Période BC': 'periode_bc',
  'NB BC': 'nb_bc',
  'Date Envoi DR': 'date_envoi_cdg',
  'Date Envoi CDG': 'date_envoi_cdg',
  'Date de Paiement': 'date_paiement',
  'Date Prévu Livraison': 'date_prevue_livraison',
  'Date Reception Facture': 'date_reception_facture',
  'N° Facture': 'numero_facture',
  'BL': 'bl',
  'BE': 'be',
  'Date Transmission': 'date_transmission',
  'Statut': 'statut',
  'Catégorie Achat': 'categorie_achat',
  'Acheteur': 'acheteur',
  'OBS': 'obs',
  'Action Requise': 'action_requise',
  'Priorité': 'priorite'
};

// Mapping inverse pour l'export (DB -> Excel)
const DB_TO_EXCEL_MAPPING = {};
for (const [excelCol, dbCol] of Object.entries(EXCEL_COLUMN_MAPPING)) {
  DB_TO_EXCEL_MAPPING[dbCol] = excelCol;
}

// Colonnes de la base de données (dans l'ordre)
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
  'statut', 'categorie_achat', 'acheteur', 'obs', 'cas_exceptionnel', 'action_requise',
  'priorite', 'budget_valide', 'immatriculation_vehicule', 'utilisateur_vehicule'
];

// ============================================================
// FONCTIONS DE CONVERSION
// ============================================================

/**
 * Convertit une date Excel en format ISO (YYYY-MM-DD)
 */
function excelDateToISO(excelDate) {
  if (excelDate === undefined || excelDate === null || excelDate === '') return null;

  const formatDate = (date) => {
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const dateFromParts = (year, month, day) => {
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return formatDate(date);
  };

  if (excelDate instanceof Date) {
    return formatDate(excelDate);
  }

  if (typeof excelDate === 'number') {
    // Excel date serial number (days since 1900-01-01).
    if (excelDate > 30000 && excelDate < 50000) {
      return formatDate(new Date((excelDate - 25569) * 86400 * 1000));
    }
    return formatDate(new Date(excelDate));
  }

  if (typeof excelDate === 'string') {
    const clean = excelDate.trim();
    const slashMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (slashMatch) {
      const [, firstPart, secondPart, rawYear] = slashMatch;
      const year = Number(rawYear.length === 2 ? `20${rawYear}` : rawYear);
      const first = Number(firstPart);
      const second = Number(secondPart);
      const month = second > 12 && first <= 12 ? first : second;
      const day = second > 12 && first <= 12 ? second : first;
      return dateFromParts(year, Number(month), Number(day));
    }
    if (/^\d{1,2}\/\d{1,2}\/\d+$/.test(clean)) return null;

    const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch.map(Number);
      return dateFromParts(year, month, day);
    }

    // Keep support for unambiguous date strings previously accepted by Date.
    return formatDate(new Date(clean));
  }

  return null;
}

/**
 * Nettoie et convertit une valeur pour l'import
 */
function cleanValue(value, key) {
  if (value === undefined || value === null || value === '') return null;
  
  // Pour les champs booléens
  if (key === 'cas_exceptionnel' || key === 'budget_valide') {
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    if (['true', 't', '1', 'yes', 'y', 'oui', 'o'].includes(s)) return true;
    if (['false', 'f', '0', 'no', 'n', 'non'].includes(s)) return false;
    return null;
  }
  
  // Pour les dates
  if (key.includes('date') || key === 'date') {
    const normalizedDate = excelDateToISO(value);
    if (!normalizedDate) {
      throw new Error(`Date invalide pour ${key}: ${String(value)}`);
    }
    return normalizedDate;
  }
  
  // Pour les nombres
  const numericFields = ['montant_budget', 'ecart_budget', 'prix_reference', 'prix_unitaire', 
                         'ecart_pourcentage', 'quantite', 'montant_ht', 'gain_achat'];
  if (numericFields.includes(key)) {
    if (typeof value === 'string') {
      // Supprimer les espaces et remplacer la virgule par un point
      const cleaned = value.replace(/\s/g, '').replace(',', '.');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    }
    if (typeof value === 'number') return value;
    return null;
  }
  
  // Pour les autres champs, retourner la valeur sous forme de chaîne
  return String(value).trim();
}

/**
 * Formate une date pour l'export (JJ/MM/AAAA)
 */
function formatDateForExport(value) {
  if (!value) return null;
  
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (e) {
    return value;
  }
}

function normalizeDateValue(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      return isNaN(date.getTime()) ? null : date;
    }

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      return isNaN(date.getTime()) ? null : date;
    }

    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function getDateKey(value) {
  const date = normalizeDateValue(value);
  if (!date) return null;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function insertWithSavepoint(client, insertQuery, values, lineNumber) {
  const savepointName = `import_row_${lineNumber}`;
  await client.query(`SAVEPOINT ${savepointName}`);

  try {
    await client.query(insertQuery, values);
    await client.query(`RELEASE SAVEPOINT ${savepointName}`);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => {});
    await client.query(`RELEASE SAVEPOINT ${savepointName}`).catch(() => {});
    throw error;
  }
}

async function insertImportedRows(client, data) {
  const insertColumns = `
    numero_da, date, date_reception_physique, filiale, departement_demandeur,
    designation_demandee, designation_commandee, code_budget, montant_budget,
    ecart_budget, statut_budget, mode_consultation, fournisseur_retenu,
    fournisseurs_consultes, prix_reference, prix_unitaire, ecart_pourcentage,
    quantite, unite, montant_ht, gain_achat, devise, type_paiement,
    delai_paiement, statut_paiement, date_envoi_consultation, date_envoi_tco,
    date_valid_filiale, date_valid_comite, pv_numero, num_bc, date_envoi_bc,
    periode_bc, nb_bc, date_envoi_cdg, date_paiement, date_prevue_livraison,
    date_reception_facture, numero_facture, bl, be, date_transmission,
    statut, categorie_achat, acheteur, obs, cas_exceptionnel, action_requise,
    priorite, budget_valide, immatriculation_vehicule, utilisateur_vehicule
  `;
  const insertQuery = `INSERT INTO achats (${insertColumns}) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
    $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
    $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
    $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
    $51, $52
  )`;

  let inserted = 0;
  let skipped = 0;
  const errors = [];

  const preparedRows = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    try {
      const cleanRow = {};
      let hasData = false;

      for (const [excelCol, dbCol] of Object.entries(EXCEL_COLUMN_MAPPING)) {
        const value = row[excelCol];
        if (value !== undefined && value !== null && value !== '') {
          const cleaned = cleanValue(value, dbCol);
          if (cleaned !== null && cleaned !== '') {
            cleanRow[dbCol] = cleaned;
            hasData = true;
          }
        }
      }

      if (!hasData) {
        skipped++;
        continue;
      }

      calculateAchatFields(cleanRow);
      const values = COLUMN_KEYS.map((key) => cleanRow[key] === '' ? null : (cleanRow[key] ?? null));
      preparedRows.push({ values, line: i + 2 });
    } catch (rowErr) {
      errors.push(`Ligne ${i + 2}: ${rowErr.message}`);
    }
  }

  for (const row of preparedRows) {
    try {
      await insertWithSavepoint(client, insertQuery, row.values, row.line);
      inserted++;
    } catch (rowErr) {
      errors.push(`Ligne ${row.line}: ${rowErr.message}`);
    }
  }

  return { inserted, skipped, errors };
}

async function readExcelFolder(folderPath) {
  let entries;
  try {
    entries = await fs.readdir(folderPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Dossier d'import introuvable ou non monte: ${folderPath}`);
    }
    if (error.code === 'EACCES') {
      throw new Error(`Acces refuse au dossier d'import: ${folderPath}`);
    }
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile()
      && !entry.name.startsWith('~$')
      && /\.(xlsx|xls)$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (files.length === 0) {
    throw new Error('Le dossier ne contient aucun fichier Excel (.xlsx ou .xls).');
  }

  const rows = [];
  for (const file of files) {
    const workbook = XLSX.readFile(path.join(folderPath, file.name), { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error(`Le fichier ${file.name} ne contient aucune feuille.`);
    rows.push(...XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null }));
  }

  return { rows, files: files.length, fileNames: files.map((file) => file.name) };
}

// ============================================================
// ROUTES
// ============================================================

/**
 * POST /api/admin/import-achats
 * Importe des données depuis un fichier Excel
 */
router.post('/import-achats', async (req, res) => {
  try {
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;
    
    const role = normalizeRole(currentUser.role);
    if (role !== 'admin') {
      return res.status(403).json({ 
        error: 'Accès refusé : seul un administrateur peut importer des données.' 
      });
    }
    
    const { data, replace = false } = req.body;
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Aucune donnée à importer.' });
    }
    
    const pool = await getPool();
    const client = await pool.connect();
    let inserted = 0;
    let skipped = 0;
    const errors = [];
    
    try {
      await client.query('BEGIN');
      if (replace) {
        await client.query('DELETE FROM achats');
      }
      
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
          statut, categorie_achat, acheteur, obs, cas_exceptionnel, action_requise,
          priorite, budget_valide, immatriculation_vehicule, utilisateur_vehicule
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
          $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
          $51, $52
        )
      `;
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        try {
          // Créer un objet avec les valeurs nettoyées
          const cleanRow = {};
          let hasData = false;
          
          for (const [excelCol, dbCol] of Object.entries(EXCEL_COLUMN_MAPPING)) {
            let value = row[excelCol];
            if (value !== undefined && value !== null && value !== '') {
              const cleaned = cleanValue(value, dbCol);
              if (cleaned !== null && cleaned !== '') {
                cleanRow[dbCol] = cleaned;
                hasData = true;
              }
            }
          }
          
          // Ignorer les lignes vides
          if (!hasData) {
            skipped++;
            continue;
          }

          calculateAchatFields(cleanRow);

          // Construire les valeurs dans l'ordre des colonnes
          const values = COLUMN_KEYS.map(key => {
            const val = cleanRow[key];
            // Si c'est une chaîne vide, la convertir en null
            if (val === '') return null;
            return val !== undefined ? val : null;
          });
          
          await insertWithSavepoint(client, insertQuery, values, i + 2);
          inserted++;
          
        } catch (rowErr) {
          errors.push(`Ligne ${i + 2}: ${rowErr.message}`);
          console.error(`Erreur insertion ligne ${i + 2}:`, rowErr);
        }
      }
      
      await client.query('COMMIT');
      client.release();
      
      res.json({
        success: true,
        inserted,
        skipped,
        errors: errors.length > 0 ? errors : undefined
      });
      
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
    
  } catch (err) {
    console.error('❌ Erreur import:', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

/**
 * POST /api/admin/refresh-achats
 * Remplace les donnees par les fichiers Excel du partage configure.
 * Seuls les administrateurs peuvent declencher l actualisation.
 */
router.post('/refresh-achats', async (req, res) => {
  let client;
  try {
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;
    if (normalizeRole(currentUser.role) !== 'admin') {
      return res.status(403).json({
        error: 'Accès refusé : seul un administrateur peut actualiser les données.'
      });
    }

    const pool = await getPool();
    client = await pool.connect();
    await client.query('BEGIN');
    const imported = await readExcelFolder(IMPORT_FOLDER_PATH);
    const { rows } = imported;
    if (rows.length === 0) {
      throw new Error('Les quatre fichiers Excel ne contiennent aucune donnee.');
    }

    await client.query('DELETE FROM achats');

    const result = await insertImportedRows(client, rows);
    if (result.errors.length > 0 || result.inserted === 0) {
      throw new Error(result.errors[0] || "Aucune ligne valide n'a pu etre importee.");
    }

    await client.query('COMMIT');
    return res.json({ success: true, ...result, files: imported.files, fileNames: imported.fileNames });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur actualisation depuis le dossier Excel:', err);
    return res.status(400).json({ error: err.message || 'Impossible d actualiser les donnees.' });
  } finally {
    if (client) client.release();
  }
});

/**
 * GET /api/admin/export-achats
 * Exporte les données vers un fichier Excel
 */
router.get('/export-achats', async (req, res) => {
  try {
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;
    
    const role = normalizeRole(currentUser.role);
    if (role !== 'admin') {
      return res.status(403).json({ 
        error: 'Accès refusé : seul un administrateur peut exporter des données.' 
      });
    }

    const { startDate, endDate } = req.query;
    const pool = await getPool();
    const result = await pool.query('SELECT * FROM achats ORDER BY id');

    const normalizedStart = startDate ? getDateKey(startDate) : null;
    const normalizedEnd = endDate ? getDateKey(endDate) : null;

    const filteredRows = result.rows.filter(row => {
      const rowDateKey = getDateKey(row.date);
      if (!rowDateKey) {
        return false;
      }

      if (normalizedStart && rowDateKey < normalizedStart) {
        return false;
      }

      if (normalizedEnd && rowDateKey > normalizedEnd) {
        return false;
      }

      return true;
    });
    
    console.log(`📤 Export: ${filteredRows.length} lignes trouvées${startDate || endDate ? ' avec filtre de période' : ''}`);
    
    // Convertir les données pour l'export
    const exportData = filteredRows.map(row => {
      const exportRow = {};
      
      for (const [dbCol, excelCol] of Object.entries(DB_TO_EXCEL_MAPPING)) {
        let value = row[dbCol];
        
        if (value !== null && value !== undefined) {
          // Formater les dates
          if (dbCol.includes('date') || dbCol === 'date') {
            const formatted = formatDateForExport(value);
            if (formatted !== null) {
              exportRow[excelCol] = formatted;
              continue;
            }
          }
          
          // Formater les nombres (garder tel quel)
          if (typeof value === 'number') {
            exportRow[excelCol] = value;
            continue;
          }
          
          // Autres valeurs
          exportRow[excelCol] = value;
        }
      }
      
      return exportRow;
    });
    
    res.json({
      success: true,
      data: exportData,
      count: exportData.length
    });
    
  } catch (err) {
    console.error('❌ Erreur export:', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

/**
 * DELETE /api/admin/achats
 * Supprime toutes les donnees d'achats (administrateur uniquement)
 */
router.delete('/achats', async (req, res) => {
  try {
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;

    if (normalizeRole(currentUser.role) !== 'admin') {
      return res.status(403).json({
        error: 'Acces refuse : seul un administrateur peut supprimer les donnees.'
      });
    }

    const pool = await getPool();
    const result = await pool.query('DELETE FROM achats');
    return res.json({
      success: true,
      deleted: result.rowCount
    });
  } catch (err) {
    console.error('Erreur suppression donnees achats:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

/**
 * DELETE /api/admin/achats/by-pv
 * Supprime les achats correspondant a un numero de PV
 */
router.delete('/achats/by-pv', async (req, res) => {
  try {
    const currentUser = await getAuthenticatedUser(req, res);
    if (!currentUser) return;

    if (normalizeRole(currentUser.role) !== 'admin') {
      return res.status(403).json({
        error: 'Acces refuse : seul un administrateur peut supprimer les donnees.'
      });
    }

    const pvNumero = String(req.body?.pvNumero || '').trim();
    if (!pvNumero) {
      return res.status(400).json({ error: 'Le numero de PV est requis.' });
    }

    const pool = await getPool();
    const result = await pool.query(
      `DELETE FROM achats
       WHERE LOWER(TRIM(COALESCE(pv_numero, ''))) = LOWER(TRIM($1))
       RETURNING id`,
      [pvNumero]
    );

    console.log(`Suppression admin PV ${pvNumero} : ${result.rowCount} ligne(s) supprimee(s)`);
    return res.json({ success: true, pvNumero, deleted: result.rowCount });
  } catch (err) {
    console.error('Erreur suppression par numero PV:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

module.exports = router;