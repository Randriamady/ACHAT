function normalizeRole(role) {
  const raw = String(role || '').trim().toLowerCase();
  if (!raw) return 'utilisateur';
  const map = {
    'back office': 'back_office',
    'back_office': 'back_office',
    'backoffice': 'back_office',
    'achat': 'achat',
    'cdg': 'cdg',
    'validateur': 'validateur',
    'validator': 'validateur',
    'admin': 'admin',
    'utilisateur': 'utilisateur',
    'user': 'utilisateur'
  };
  return map[raw] || raw.replace(/\s+/g, '_');
}

function getUserScopeValue(user) {
  return String(user?.name || user?.identifier || user?.full_name || '').trim();
}

function isOwnDataRole(role) {
  const normalized = normalizeRole(role);
  return ['utilisateur', 'achat'].includes(normalized);
}

function canAccessAchatPage(role) {
  return ['admin', 'validateur', 'cdg', 'achat', 'back_office', 'utilisateur'].includes(normalizeRole(role));
}

function canAccessTab(role, tab) {
  const normalized = normalizeRole(role);
  if (tab === 'admin') return normalized === 'admin';
  if (tab === 'pv') return normalized === 'admin' || normalized === 'validateur';
  return ['dashboard', 'dossiers', 'retards', 'financier', 'pv', 'admin'].includes(tab);
}

function getRestrictedAchatFields() {
  return [
    'numero_da', 'date', 'date_reception_physique', 'filiale', 'departement_demandeur',
    'designation_demandee', 'designation_commandee', 'code_budget', 'montant_budget',
    'ecart_budget', 'statut_budget', 'mode_consultation', 'fournisseur_retenu',
    'fournisseurs_consultes', 'prix_reference', 'prix_unitaire', 'ecart_pourcentage',
    'quantite', 'unite', 'montant_ht', 'gain_achat', 'devise', 'type_paiement',
    'delai_paiement', 'statut_paiement', 'date_envoi_consultation', 'date_envoi_tco',
    'date_valid_filiale', 'date_valid_comite', 'pv_numero'
  ];
}

function getAllowedEditableAchatFields(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'cdg') return ['code_budget', 'montant_budget'];
  if (normalized === 'back_office') {
    return ['num_bc', 'date_envoi_bc', 'immatriculation_vehicule', 'utilisateur_vehicule',
            'periode_bc', 'nb_bc', 'date_envoi_cdg', 
            'date_paiement', 'date_prevue_livraison', 'date_reception_facture', 'numero_facture',
            'bl', 'be', 'date_transmission', 'statut', 'categorie_achat',
            'obs', 'cas_exceptionnel', 'action_requise', 'priorite', 'budget_valide'];
  }
  return null;
}

function canCreateAchat(role) {
  const normalized = normalizeRole(role);
  return normalized !== 'utilisateur';
}

// ============================================================
// FONCTION : Vérifier si le montant budget est vide
// ============================================================
function isMontantBudgetEmpty(row) {
  if (!row || typeof row !== 'object') return true;
  const val = row['montant_budget'];
  return val === undefined || val === null || val === '' || String(val).trim() === '';
}

function validateAchatWritePermissions(role, rowData, existingRowData = {}) {
  const normalized = normalizeRole(role);
  if (!rowData || typeof rowData !== 'object') return { ok: true };

  const normalizeComparableValue = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;

      const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/);
      if (isoDateMatch) return `${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}`;

      const frDateMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (frDateMatch) {
        const day = String(frDateMatch[1]).padStart(2, '0');
        const month = String(frDateMatch[2]).padStart(2, '0');
        const year = frDateMatch[3].length === 2 ? `20${frDateMatch[3]}` : frDateMatch[3];
        return `${year}-${month}-${day}`;
      }

      const numericCandidate = trimmed.replace(/\s/g, '').replace(',', '.');
      const numericValue = Number(numericCandidate);
      if (!Number.isNaN(numericValue) && numericCandidate !== '' && /^[-+]?\d*\.?\d+$/.test(numericCandidate)) {
        return numericValue;
      }

      return trimmed.toLowerCase();
    }
    return value;
  };

  const ignoredFields = new Set([
    'id', 'created_at', 'updated_at', 'acheteur', 'montant_ht', 'ecart_budget',
    'statut_budget', 'ecart_pourcentage', 'gain_achat', 'cas_exceptionnel', 'budget_valide'
  ]);

  const submittedFields = Object.keys(rowData).filter(key => {
    if (!key || ignoredFields.has(key) || key.startsWith('_')) return false;
    const value = rowData[key];
    if (value === undefined || value === null || value === '') return false;
    const existingValue = existingRowData?.[key];
    return normalizeComparableValue(existingValue) !== normalizeComparableValue(value);
  });

  if (normalized === 'back_office') {
    const allowed = getAllowedEditableAchatFields(normalized);
    const forbidden = submittedFields.filter(field => !allowed.includes(field));
    if (forbidden.length > 0) {
      return { ok: false, message: 'Le rôle back office ne peut modifier que les colonnes de N°BC jusqu\'à la fin (sauf acheteur).' };
    }
    return { ok: true };
  }

  if (normalized === 'cdg') {
    const allowed = getAllowedEditableAchatFields(normalized);
    const forbidden = submittedFields.filter(field => !allowed.includes(field));
    if (forbidden.length > 0) {
      return { ok: false, message: 'Le rôle CDG ne peut modifier que les colonnes Code Budget et Montant Budget.' };
    }
    return { ok: true };
  }

  return { ok: true };
}

function filterRowsForRole(rows, user) {
  if (!Array.isArray(rows)) return [];
  const role = normalizeRole(user?.role);
  if (!isOwnDataRole(role)) return rows;
  const ownerValue = getUserScopeValue(user);
  return rows.filter(row => {
    const rowOwner = String(row?.acheteur || row?.owner || '').trim();
    return !ownerValue || rowOwner === ownerValue;
  });
}

module.exports = {
  normalizeRole,
  getUserScopeValue,
  isOwnDataRole,
  canAccessAchatPage,
  canAccessTab,
  validateAchatWritePermissions,
  filterRowsForRole,
  getRestrictedAchatFields,
  getAllowedEditableAchatFields,
  canCreateAchat,
  isMontantBudgetEmpty
};