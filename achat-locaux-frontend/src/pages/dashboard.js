// ============================================================
// DASHBOARD
// ============================================================

const escapeHtml = value => String(value||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'&#10;');
const escapeAttr = escapeHtml;

const uniqueList = (array, limit = Infinity) => [...new Set(array.filter(v => v !== undefined && v !== null && String(v).trim() !== '').map(String))].slice(0, limit);
const groupedDesignation = (rows) => {
  const keys = {};
  rows.forEach(r => {
    const label = (r['designation_demandee'] || r['designation_commandee'] || 'Sans désignation').trim();
    if (!label) return;
    keys[label] = (keys[label] || 0) + 1;
  });
  return Object.entries(keys)
    .sort((a,b) => b[1] - a[1])
    .map(([label, count]) => `${label}${count > 1 ? ` (${count})` : ''}`)
    .join(', ');
};

const groupedFiliale = (rows) => {
  const values = uniqueList(rows.map(r => r['filiale']));
  return values.length ? values.join(', ') : 'Sans filiale';
};

// Retourne les lignes dédupliquées pour les KPI (préférence par `id`, sinon par `numero_da|pv|fournisseur`)
function getRowsForKpi() {
  const source = (window && window.__USE_PAGED_MODE) ? (window.ALL_DATA || ALL_DATA) : (window.FILTERED || FILTERED);
  const map = new Map();
  const keyOf = (r) => {
    if (!r || typeof r !== 'object') return JSON.stringify(r);
    if (r.id !== undefined && r.id !== null && r.id !== '') return `id:${r.id}`;
    const da = String(r.numero_da || '').trim();
    const pv = String(r.pv_numero || '').trim();
    const f = String(r.fournisseur_retenu || '').trim();
    return `da:${da}|pv:${pv}|f:${f}`;
  };
  if (!Array.isArray(source)) return [];
  source.forEach(r => {
    const k = keyOf(r);
    // keep the last occurrence (most recent) for this key
    map.set(k, r);
  });
  return Array.from(map.values());
}

// ============================================================
// Prédicats KPI "Attente comité" / "Validé comité" / "En attente CDG"
// ------------------------------------------------------------
// Règles :
// - En attente CDG : montant_budget vide/null ET date_valid_comite vide
// - Attente comité  : statut_budget renseigné OU code_budget Stock/Stocks, ET date_valid_comite vide
// - Validé comité   : date_valid_comite renseignée
// ============================================================
function isNonTraiteCDGRow(r) {
  const montantBudget = r['montant_budget'];
  const validComiteDate = r['date_valid_comite'];
  const montantBudgetEmpty = montantBudget === null || montantBudget === undefined || String(montantBudget).trim() === '';
  const validComiteDateEmpty = !validComiteDate || String(validComiteDate).trim() === '';
  return montantBudgetEmpty && validComiteDateEmpty;
}

function isAttenteComiteRow(r) {
  const budgetStatus = r['statut_budget'];
  const codeBudget = String(r['code_budget'] || '').trim().toLowerCase();
  const validComiteDate = r['date_valid_comite'];
  const hasBudgetStatus = Boolean(budgetStatus) && String(budgetStatus).trim() !== '';
  const isStockBudget = codeBudget === 'stock' || codeBudget === 'stocks';
  return (hasBudgetStatus || isStockBudget) &&
    (!validComiteDate || String(validComiteDate).trim() === '');
}

function isValideComiteRow(r) {
  const validComiteDate = r['date_valid_comite'];
  return Boolean(validComiteDate) && String(validComiteDate).trim() !== '';
}

function normalizeDashboardStatus(status) {
  return String(status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function isOperationalCommitteePendingRow(r) {
  return normalizeDashboardStatus(r['statut']) === 'attente comite';
}

function isBCSignatureInProgressRow(r) {
  return normalizeDashboardStatus(r['statut']) === 'bc en cours de signature';
}

function isEligibleForPVRow(r) {
  const budgetStatus = String(r['statut_budget'] || '').trim();
  const codeBudget = String(r['code_budget'] || '').trim().toLowerCase();
  const validComiteDate = String(r['date_valid_comite'] || '').trim();
  return !validComiteDate && (Boolean(budgetStatus) || codeBudget === 'stock' || codeBudget === 'stocks');
}

function isCasExceptionnelRow(r) {
  if (!r || typeof r !== 'object') return false;
  const raw = r['cas_exceptionnel'];
  if (raw === true || raw === 1 || raw === '1') return true;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return normalized === 'true' || normalized === 'oui' || normalized === 'yes' || normalized === 'x' || normalized === 'cas exceptionnel';
  }
  return Boolean(raw);
}

function getEffectiveDashboardCriticite(row) {
  return isCasExceptionnelRow(row) ? 'Normal' : (row && row._criticite) || 'Normal';
}

function getPVTableRowsForDashboard(rows) {
  const eligible = rows.filter(r => {
    const budgetStatus = r['statut_budget'];
    const validComiteDate = r['date_valid_comite'];
    return budgetStatus && String(budgetStatus).trim() !== '' && (!validComiteDate || String(validComiteDate).trim() === '');
  });
  if (typeof window.groupPVDossiers === 'function' && typeof window.aggregateFieldsPV === 'function') {
    return window.groupPVDossiers(eligible).map(group => window.aggregateFieldsPV(group));
  }
  return eligible;
}

// ============================================================
// FONCTION : redirection vers la page Achat avec filtre
// ============================================================
function redirectToAchatWithFilters(filters) {
  const searchValue = filters.designation || filters.numero_da || '';
  if (!searchValue) return;

  if (typeof window.switchTab === 'function') {
    window.switchTab('dossiers');
  }

  const fireSearch = () => {
    document.dispatchEvent(new CustomEvent('searchFromDashboard', {
      detail: { searchValue: searchValue }
    }));
  };

  if (window.hot) {
    fireSearch();
    return;
  }

  let alreadyFired = false;
  const onReady = () => {
    if (alreadyFired) return;
    alreadyFired = true;
    document.removeEventListener('dossiersTableReady', onReady);
    fireSearch();
  };
  document.addEventListener('dossiersTableReady', onReady);

  setTimeout(() => {
    if (alreadyFired) return;
    alreadyFired = true;
    document.removeEventListener('dossiersTableReady', onReady);
    fireSearch();
  }, 800);
}

// ============================================================
// getTooltipRows - avec colonnes spécifiques
// ============================================================
function getTooltipRows(label) {
  const d = getRowsForKpi();
  const byField = (field, predicate = () => true, unique = true) => {
    const matched = d.filter(predicate);
    if (unique) {
      const keys = uniqueList(matched.map(r => r[field]));
      return keys.map(key => ({
        key,
        value: groupedDesignation(matched.filter(r => String(r[field]).trim() === String(key).trim())),
        filiale: groupedFiliale(matched.filter(r => String(r[field]).trim() === String(key).trim()))
      }));
    }
    return matched.map(r => ({
      key: r[field] || '',
      value: groupedDesignation([r]),
      filiale: (r['filiale'] || 'Sans filiale')
    }));
  };

  const getPVTooltipRows = (valid) => {
    const pvRows = getPVTableRowsForDashboard(d);
    return pvRows.map(row => ({
      numero_da: row['numero_da'] || '—',
      fournisseur_retenu: row['fournisseur_retenu'] || '—',
      statut_budget: row['statut_budget'] || '—',
      type_paiement: row['type_paiement'] || '—',
      pv_numero: row['pv_numero'] || '—',
      designation: row['designation_commandee'] || row['designation_demandee'] || 'Sans désignation',
      filiale: row['filiale'] || 'Sans filiale',
      valid: getPVDecisionValueForDashboard(row),
      searchValue: [row['numero_da'], row['fournisseur_retenu'], row['statut_budget'], row['type_paiement'], row['pv_numero'], row['designation_commandee'] || row['designation_demandee']].join(' ')
    })).filter(item => item.valid === valid).map(item => ({
      key: item.pv_numero,
      numero_da: item.numero_da,
      fournisseur_retenu: item.fournisseur_retenu,
      statut_budget: item.statut_budget,
      type_paiement: item.type_paiement,
      pv_numero: item.pv_numero,
      designation: item.designation,
      filiale: item.filiale,
      searchValue: item.searchValue
    }));
  };

  if (label === 'En attente CDG') {
    const matched = d.filter(isNonTraiteCDGRow);
    return matched.map(r => ({
      key: r['numero_da'] || '—',
      designation: r['designation_demandee'] || r['designation_commandee'] || 'Sans désignation',
      code_budget: r['code_budget'] || '—',
      montant_budget: r['montant_budget'] || 0,
      fournisseur_retenu: r['fournisseur_retenu'] || '—',
      date_valid_comite: r['date_valid_comite'] || 'Non défini',
      filiale: r['filiale'] || 'Sans filiale',
      id: r.id,
      searchValue: r['designation_demandee'] || r['designation_commandee'] || '',
      _row: r
    }));
  }

  if (label === 'Attente comité') {
    const matched = d.filter(isAttenteComiteRow);
    return matched.map(r => ({
      key: r['numero_da'] || '—',
      designation: r['designation_demandee'] || r['designation_commandee'] || 'Sans désignation',
      code_budget: r['code_budget'] || '—',
      montant_budget: r['montant_budget'] || 0,
      fournisseur_retenu: r['fournisseur_retenu'] || '—',
      date_valid_comite: r['date_valid_comite'] || 'Non défini',
      filiale: r['filiale'] || 'Sans filiale',
      id: r.id,
      searchValue: r['designation_demandee'] || r['designation_commandee'] || '',
      _row: r
    }));
  }

  if (label === 'Validé comité') {
    const matched = d.filter(isValideComiteRow);
    return matched.map(r => ({
      key: r['numero_da'] || '—',
      designation: r['designation_demandee'] || r['designation_commandee'] || 'Sans désignation',
      code_budget: r['code_budget'] || '—',
      montant_budget: r['montant_budget'] || 0,
      fournisseur_retenu: r['fournisseur_retenu'] || '—',
      date_valid_comite: r['date_valid_comite'] || 'Non défini',
      filiale: r['filiale'] || 'Sans filiale',
      id: r.id,
      searchValue: r['designation_demandee'] || r['designation_commandee'] || '',
      _row: r
    }));
  }

  if (label === 'Dossiers éligibles PV') {
    const eligibleRows = d.filter(isEligibleForPVRow);
    const groupedRows = typeof window.groupPVDossiers === 'function' && typeof window.aggregateFieldsPV === 'function'
      ? window.groupPVDossiers(eligibleRows).map(group => window.aggregateFieldsPV(group))
      : eligibleRows;
    return groupedRows.map(r => ({
      numero_da: r['numero_da'] || '—',
      designation: r['designation_commandee'] || r['designation_demandee'] || 'Sans désignation',
      code_budget: r['code_budget'] || '—',
      montant_budget: r['montant_budget'] ?? '—',
      fournisseur_retenu: r['fournisseur_retenu'] || '—',
      statut_budget: r['statut_budget'] || '—',
      type_paiement: r['type_paiement'] || '—',
      pv_numero: r['pv_numero'] || '—'
    }));
  }

  switch (label) {
    case 'DA TOTAL (distinct)':
      return byField('numero_da', r => r['numero_da']);
    case 'Budget total':
      {
        const pvRows = getPVTableRowsForDashboard(d);
        const map = {};
        pvRows.forEach(r => {
          const budget = Number(r['montant_budget']) || 0;
          const ht = Number(r['montant_ht']) || 0;
          const f = r['filiale'] || 'Sans filiale';
          if (!map[f]) map[f] = { budget: 0, ht: 0 };
          map[f].budget += budget;
          map[f].ht += ht;
        });
        return Object.keys(map).map(f => ({
          key: f,
          value: `Budget ${map[f].budget.toFixed(2)} — HT ${map[f].ht.toFixed(2)}`,
          filiale: f
        }));
      }
    case 'TOTAL BC':
      return byField('num_bc', r => r['num_bc']);
    case 'TOTAL PV':
      return byField('pv_numero', r => r['pv_numero']);
    case 'PV avec budget conforme':
      return getPVTooltipRows(true);
    case 'PV avec budget non conforme':
      return getPVTooltipRows(false);
    case 'Livré':
      return byField('num_bc', r => r['statut'] === 'Livré' && r['num_bc'], false);
    case 'BC Stand-by':
      return byField('num_bc', r => r['statut'] && /standby|stand-by|stand by/i.test(r['statut']) && r['num_bc'], false);
    case 'BC ATTENTE CHOIX FILIALE':
      return byField('num_bc', r => r['statut'] && /attente.*filiale/i.test(r['statut']) && r['num_bc'], false);
    default:
      return [];
  }
}

// ============================================================
// tooltipTableFor - avec colonnes personnalisées
// ============================================================
function tooltipSearchBarHtml() {
  return `
    <div class="kpi-tooltip-search-wrap">
      <input type="text" class="kpi-tooltip-search" placeholder="Rechercher par désignation..." autocomplete="off" spellcheck="false" />
    </div>`;
}

function formatTooltipDate(value) {
  if (value === undefined || value === null || value === '' || value === 'Non défini') return 'Non défini';

  if (typeof window !== 'undefined' && typeof window.fmtDate === 'function') {
    const formatted = window.fmtDate(value);
    if (formatted && formatted !== '—') {
      return formatted;
    }
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const frMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (frMatch) {
    return `${String(frMatch[1]).padStart(2, '0')}/${String(frMatch[2]).padStart(2, '0')}/${frMatch[3]}`;
  }

  const dateObj = new Date(text);
  if (!Number.isNaN(dateObj.getTime())) {
    return `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
  }

  return text;
}

function tooltipTableFor(label) {
  const rows = getTooltipRows(label);
  if (!rows.length) return `<div class="kpi-tooltip-empty">Aucun élément</div>`;
  
  if (label === 'Attente comité' || label === 'Validé comité' || label === 'En attente CDG') {
    return `
      ${tooltipSearchBarHtml()}
      <div class="kpi-tooltip-table-wrap">
        <table class="kpi-tooltip-table">
          <thead>
            <tr>
              <th>N° DA</th>
              <th>Désignation</th>
              <th>Code Budget</th>
              <th>Montant Budget</th>
              <th>Filiales</th>
              <th>Fournisseur retenu</th>
              <th>Date de comité</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr class="clickable-row" data-search-value="${escapeAttr(r.searchValue || r.designation || r.key)}" data-designation="${escapeAttr(r.designation || '')}" style="cursor:pointer;">
                <td>${escapeHtml(r.key)}</td>
                <td><strong>${escapeHtml(r.designation)}</strong></td>
                <td>${escapeHtml(r.code_budget)}</td>
                <td>${typeof r.montant_budget === 'number' || (typeof r.montant_budget === 'string' && r.montant_budget !== '') ? formatDisplayNumber(r.montant_budget, 2) : escapeHtml(r.montant_budget)}</td>
                <td>${escapeHtml(r.filiale)}</td>
                <td>${escapeHtml(r.fournisseur_retenu)}</td>
                <td>${escapeHtml(formatTooltipDate(r.date_valid_comite))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="kpi-tooltip-noresult" style="display:none;">Aucun résultat</div>
      </div>
    `;
  }

  if (label === 'PV avec budget conforme' || label === 'PV avec budget non conforme') {
    return `
      ${tooltipSearchBarHtml()}
      <div class="kpi-tooltip-table-wrap">
        <table class="kpi-tooltip-table">
          <thead>
            <tr>
              <th>N° DA</th>
              <th>Désignation</th>
              <th>Fournisseur</th>
              <th>Statut budget</th>
              <th>Type paiement</th>
              <th>PV n°</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr data-designation="${escapeAttr(r.designation || '')}" data-search-value="${escapeAttr(r.searchValue || [r.numero_da, r.fournisseur_retenu, r.statut_budget, r.type_paiement, r.pv_numero].join(' '))}">
                <td>${escapeHtml(r.numero_da)}</td>
                <td>${escapeHtml(r.designation || 'Sans désignation')}</td>
                <td>${escapeHtml(r.fournisseur_retenu)}</td>
                <td>${escapeHtml(r.statut_budget)}</td>
                <td>${escapeHtml(r.type_paiement)}</td>
                <td>${escapeHtml(r.pv_numero)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="kpi-tooltip-noresult" style="display:none;">Aucun résultat</div>
      </div>
    `;
  }

  if (label === 'Dossiers éligibles PV') {
    return `
      ${tooltipSearchBarHtml()}
      <div class="kpi-tooltip-table-wrap">
        <table class="kpi-tooltip-table">
          <thead>
            <tr>
              <th>N° DA</th>
              <th>Désignation regroupée</th>
              <th>Code budget</th>
              <th>Montant budget max</th>
              <th>Statut budget</th>
              <th>Fournisseur retenu</th>
              <th>Type de paiement</th>
              <th>N° PV</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr data-designation="${escapeAttr(r.designation || '')}">
                <td>${escapeHtml(r.numero_da)}</td>
                <td>${escapeHtml(r.designation)}</td>
                <td>${escapeHtml(r.code_budget)}</td>
                <td>${typeof r.montant_budget === 'number' || (typeof r.montant_budget === 'string' && r.montant_budget !== '') ? formatDisplayNumber(r.montant_budget, 2) : escapeHtml(r.montant_budget)}</td>
                <td>${escapeHtml(r.statut_budget)}</td>
                <td>${escapeHtml(r.fournisseur_retenu)}</td>
                <td>${escapeHtml(r.type_paiement)}</td>
                <td>${escapeHtml(r.pv_numero)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="kpi-tooltip-noresult" style="display:none;">Aucun résultat</div>
      </div>
    `;
  }
  
  return `
    ${tooltipSearchBarHtml()}
    <div class="kpi-tooltip-table-wrap">
      <table class="kpi-tooltip-table">
        <thead><tr><th>Valeur</th><th>Désignation</th><th>Filiale</th></tr></thead>
        <tbody>${rows.map(r => `<tr data-designation="${escapeAttr(r.value || '')}"><td>${escapeHtml(r.key)}</td><td>${escapeHtml(r.value)}</td><td>${escapeHtml(r.filiale)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="kpi-tooltip-noresult" style="display:none;">Aucun résultat</div>
    </div>`;
}

// ============================================================
// GESTION DES CLICS SUR LES LIGNES DU TOOLTIP
// ============================================================
function handleTooltipRowClick(e) {
  const row = e.currentTarget;
  const searchValue = row.dataset.searchValue;
  if (searchValue) {
    const tooltip = document.getElementById('kpiTooltip');
    if (tooltip) tooltip.style.display = 'none';
    redirectToAchatWithFilters({ 'designation': searchValue });
  }
}

function setupTooltipRowClick() {
  document.querySelectorAll('.clickable-row').forEach(row => {
    row.removeEventListener('click', handleTooltipRowClick);
    row.addEventListener('click', handleTooltipRowClick);
  });
}

// ============================================================
// INJECTION DES STYLES CSS (avec couleurs personnalisées)
// ============================================================
// ============================================================
// INJECTION DES STYLES CSS - Fond gris soutenu
// ============================================================
(function injectTooltipSearchStyle() {
  if (document.getElementById('kpi-tooltip-search-style')) return;
  const style = document.createElement('style');
  style.id = 'kpi-tooltip-search-style';
  style.textContent = `
    /* ============================================================
       STYLE DE L'INFO-BULLE - Fond gris soutenu
    ============================================================ */
    .kpi-tooltip {
      background: #d1d5db !important;  /* Fond gris soutenu */
      border: 1px solid #9ca3af;
      border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.18);
      padding: 8px 10px;
      min-width: 360px;
      max-width: 540px;
      max-height: 300px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: #1e293b;
    }

    .kpi-tooltip-title {
      font-weight: 700;
      font-size: 11px;
      color: #0f172a;
      padding-bottom: 4px;
      border-bottom: 2px solid #9ca3af;
      margin-bottom: 4px;
      flex-shrink: 0;
    }

    .kpi-tooltip-search-wrap {
      padding: 1px 0 4px 0;
      flex-shrink: 0;
    }

    .kpi-tooltip-search {
      width: 100%;
      box-sizing: border-box;
      padding: 4px 7px;
      border: 1px solid #9ca3af;
      border-radius: 6px;
      font-size: 10px;
      outline: none;
      background: #f8fafc;
      color: #1e293b;
    }

    .kpi-tooltip-search:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
      background: #ffffff;
    }

    .kpi-tooltip-table-wrap {
      overflow: auto;
      flex: 1 1 auto;
      max-height: 220px;
      border-radius: 8px;
      background: #f8fafc;
    }

    .kpi-tooltip-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9px;
      background: #f8fafc;
      min-width: 480px;
    }

    .kpi-tooltip-table th {
      position: sticky;
      top: 0;
      background: #cbd5e1 !important;
      color: #0f172a;
      font-weight: 600;
      padding: 4px 6px;
      text-align: left;
      border-bottom: 2px solid #9ca3af;
      z-index: 2;
      white-space: nowrap;
    }

    .kpi-tooltip-table td {
      padding: 3px 6px;
      border-bottom: 1px solid #e2e8f0;
      color: #1e293b;
      background: #f8fafc;
      vertical-align: middle;
    }

    .kpi-tooltip-table tr:hover td {
      background: #e2e8f0 !important;
    }

    .kpi-tooltip-table .clickable-row {
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .kpi-tooltip-table .clickable-row:hover td {
      background: #bfdbfe !important;
    }

    .kpi-tooltip-empty {
      padding: 14px 12px;
      text-align: center;
      color: #64748b;
      font-size: 10px;
      background: #f8fafc;
      border-radius: 8px;
    }

    .kpi-tooltip-noresult {
      padding: 8px;
      text-align: center;
      color: #94a3b8;
      font-size: 10px;
      background: #f8fafc;
      border-radius: 0 0 8px 8px;
    }
  `;
  document.head.appendChild(style);
})();
function initKpiTooltips() {
  let tooltipEl = document.getElementById('kpiTooltip');
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'kpiTooltip';
    tooltipEl.className = 'kpi-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
  }
  let tooltipPinned = false;
  let tooltipOver = false;
  let cardOver = false;
  let currentCard = null;
  let hideTimer = null;
  let restoreInterval = null;

  const positionTooltip = (card) => {
    const rect = card.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - tooltipRect.width / 2), window.innerWidth - tooltipRect.width - 8);
    const top = rect.top - tooltipRect.height - 10;
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top < 8 ? rect.bottom + 10 : top}px`;
  };

  const filterTooltipRows = (searchTerm) => {
    const term = String(searchTerm || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const wrap = tooltipEl.querySelector('.kpi-tooltip-table-wrap');
    if (!wrap) return;
    const rows = wrap.querySelectorAll('tbody tr');
    let visibleCount = 0;
    rows.forEach(tr => {
      const designation = (tr.dataset.designation || tr.textContent || '')
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const match = !term || designation.includes(term);
      tr.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });
    const noResultEl = wrap.querySelector('.kpi-tooltip-noresult');
    if (noResultEl) noResultEl.style.display = visibleCount === 0 ? '' : 'none';
  };

  const showTooltipFor = (card, persist = false) => {
    const label = card.dataset.tooltipLabel;
    currentCard = card;
    tooltipPinned = persist;
    const tooltipTitle = label === 'Dossiers éligibles PV'
      ? `${label} (${getTooltipRows(label).length})`
      : label;
    tooltipEl.innerHTML = `<div class="kpi-tooltip-title">${escapeHtml(tooltipTitle)}</div>${tooltipTableFor(label)}`;
    tooltipEl.style.display = 'block';
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    tooltipEl.style.opacity = '0';
    tooltipEl.style.left = '0px';
    tooltipEl.style.top = '0px';
    positionTooltip(card);
    requestAnimationFrame(() => { tooltipEl.style.opacity = '1'; });
    setTimeout(setupTooltipRowClick, 50);

    const searchInput = tooltipEl.querySelector('.kpi-tooltip-search');
    if (searchInput) {
      searchInput.value = '';
      searchInput.addEventListener('input', () => filterTooltipRows(searchInput.value));
      searchInput.addEventListener('click', (e) => e.stopPropagation());
      searchInput.addEventListener('mousedown', (e) => e.stopPropagation());
      searchInput.addEventListener('focus', () => { tooltipPinned = true; });
      setTimeout(() => searchInput.focus(), 60);
    }
  };

  const scheduleHide = (delay = 180) => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!tooltipPinned && !tooltipOver && !cardOver) {
        tooltipEl.style.opacity = '0';
        setTimeout(() => {
          if (!tooltipPinned && !tooltipOver && !cardOver) {
            tooltipEl.style.display = 'none';
            currentCard = null;
          }
        }, 200);
      }
      hideTimer = null;
    }, delay);
  };

  const hideTooltipImmediate = () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    tooltipEl.style.opacity = '0';
    tooltipEl.style.display = 'none';
    tooltipPinned = false;
    currentCard = null;
  };

  const hideTooltip = () => {
    tooltipPinned = false;
    hideTooltipImmediate();
  };

  document.querySelectorAll('.kpi-card[data-tooltip-label]').forEach(card => {
    card.addEventListener('click', (event) => {
      event.stopPropagation();
      if (tooltipPinned && currentCard === card) {
        hideTooltip();
      } else {
        showTooltipFor(card, true);
      }
    });
  });

  tooltipEl.addEventListener('mouseenter', () => {
    tooltipOver = true;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    tooltipEl.style.display = 'block';
    tooltipEl.style.opacity = '1';
    if (restoreInterval) clearInterval(restoreInterval);
    restoreInterval = setInterval(() => { tooltipEl.style.opacity = '1'; }, 50);
    setTimeout(() => { if (restoreInterval) { clearInterval(restoreInterval); restoreInterval = null; } }, 420);
  });
  tooltipEl.addEventListener('mouseleave', () => { tooltipOver = false; if (!tooltipPinned && !cardOver) scheduleHide(); });

  document.addEventListener('click', (event) => { if (!tooltipEl.contains(event.target) && !event.target.closest('.kpi-card')) hideTooltipImmediate(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTooltipImmediate(); });
}

function kpiCard(label, val, cls = '', sub = '', options = {}) {
  const selectedLabel = window && window.__activeKpiLabel;
  const isActive = selectedLabel === label || options.active === true;
  const active = isActive ? ' active' : '';
  const tooltipEnabled = options.tooltip !== false;
  const tooltipAttr = tooltipEnabled ? ` data-tooltip-label="${escapeAttr(label)}"` : '';
  const clickAttr = options.onClick ? ` onclick="${options.onClick}"` : '';
  return `
    <div class="kpi-card ${cls}${active}"${tooltipAttr} data-kpi-label="${escapeAttr(label)}" data-kpi-value="${escapeAttr(String(val))}"${clickAttr}>
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${val}</div>
      ${sub ? `<div class="kpi-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

// ============================================================
// RENDER DASHBOARD
// ============================================================
function renderDashboard() {
  const d = getRowsForKpi();
  const total = d.length;
  const livres = d.filter(r => r['statut'] === 'Livré').length;
  const annules = d.filter(r => r['statut'] === 'Annulé').length;
  const enCours = d.filter(r => r['statut'] !== 'Livré' && r['statut'] !== 'Annulé').length;
  const enRetard = d.filter(r=>r._hasRetard).length;
  const dossiersAnomalies = d.filter(r => r._hasAnomalies).length;

  const statutCounts = {};
  d.forEach(r => { const s = r['statut']||'Sans statut'; statutCounts[s] = (statutCounts[s]||0)+1; });
  const statutEntries = Object.entries(statutCounts).sort((a,b) => b[1]-a[1]);

  const critCounts = {'Normal':0,'Attention':0,'Critique':0,'Très Critique':0};
  d.forEach(r => {
    const effectiveCrit = getEffectiveDashboardCriticite(r);
    critCounts[effectiveCrit] = (critCounts[effectiveCrit]||0)+1;
  });

  const retardTypes = ['Consultation','Envoi TCO','Validation Filiale','Validation Comité','Signature BC','Livraison'];
  const retardCounts = {};
  retardTypes.forEach(t => retardCounts[t] = 0);
  d.forEach(r => {
    if (!r._hasAnomalies && r._retards && r._retards.length > 0) {
      const lastRetard = r._retards[r._retards.length - 1];
      if (retardCounts[lastRetard.type] !== undefined) retardCounts[lastRetard.type]++;
    }
  });

  const uniqueList = (array, limit = Infinity) => [...new Set(array.filter(v => v !== undefined && v !== null && String(v).trim() !== '').map(String))].slice(0, limit);
  const groupedDesignation = (rows) => {
    const keys = {};
    rows.forEach(r => {
      const label = (r['designation_demandee'] || r['designation_commandee'] || 'Sans désignation').trim();
      if (!label) return;
      keys[label] = (keys[label] || 0) + 1;
    });
    return Object.entries(keys)
      .sort((a,b) => b[1] - a[1])
      .map(([label, count]) => `${label}${count > 1 ? ` (${count})` : ''}`)
      .join(', ');
  };

  // KPI principaux
  const primaryLabels = [
    'DA TOTAL (distinct)',
    'TOTAL BC'
  ];

  const values = {};
  const subValues = {};
  const countDistinctDA = (predicate = () => true) => new Set(
    d.filter(predicate)
      .map(row => String(row['numero_da'] || '').trim())
      .filter(Boolean)
  ).size;
  const countDossiers = (predicate = () => true) => d.filter(predicate).length;
  const eligiblePVRows = d.filter(isEligibleForPVRow);
  const eligiblePVGroups = typeof window.groupPVDossiers === 'function'
    ? window.groupPVDossiers(eligiblePVRows)
    : eligiblePVRows;
  values['DA TOTAL (distinct)'] = new Set(d.filter(r => r['numero_da']).map(r => String(r['numero_da']).trim())).size;
  values['TOTAL BC'] = countDistinctDA(r => r['num_bc']);

  const budgetComiteHtml = [
    kpiCard('En attente CDG', countDossiers(isNonTraiteCDGRow)),
    kpiCard('Validé comité', countDossiers(isValideComiteRow)),
    kpiCard('Attente comité', countDossiers(isAttenteComiteRow)),
    kpiCard('Dossiers éligibles PV', eligiblePVGroups.length)
  ].join('');
  
  const hiddenKpis = [
    {label:'Cas exceptionnel', value: d.filter(isCasExceptionnelRow).length},
    {label:'TOTAL PV', value: new Set(d.filter(r => r['pv_numero']).map(r => String(r['pv_numero']).trim())).size},
    {label:'BC Stand-by', value: d.filter(r => r['statut'] && /standby|stand-by|stand by/i.test(r['statut'])).length},
    {label:'BC ATTENTE CHOIX FILIALE', value: d.filter(r => r['statut'] && /attente.*filiale/i.test(r['statut'])).length},
    {label:'Consultation', value: retardCounts['Consultation']||0},
    {label:'Envoi TCO', value: retardCounts['Envoi TCO']||0},
    {label:'Signature BC', value: retardCounts['Signature BC']||0},
    {label:'Validation Filiale', value: retardCounts['Validation Filiale']||0},
    {label:'Livraison', value: retardCounts['Livraison']||0},
    {label:'Attention', value: critCounts['Attention']||0},
    {label:'Critique', value: critCounts['Critique']||0}
  ];

  const hiddenLabels = hiddenKpis.map(k => k.label);
  const visiblePrimaryLabels = primaryLabels.filter(l => !hiddenLabels.includes(l));
  window.__hiddenKpiLabels = hiddenLabels;
  const noShadowLabels = new Set(['DA TOTAL (distinct)','TOTAL BC']);
  const primaryHtml = visiblePrimaryLabels.map(label => kpiCard(label, values[label]||0, noShadowLabels.has(label) ? 'no-shadow' : '', subValues[label] || '')).join('');

  const othersHtml = hiddenKpis.map(k => kpiCard(k.label, k.value||0)).join('');

  const html = `
    <div class="kpi-section">
      <div class="kpi-section-title">KPI PRINCIPAUX REGROUPÉS PAR DA | KPI BUDGÉTAIRE ET COMITÉ</div>
      <div class="kpi-single-line-wrap">
        <div class="kpi-grid-row kpi-grid-row-primary kpi-single-line-row" id="kpiPrimaryRow">${primaryHtml}${budgetComiteHtml}</div>
      </div>
    </div>
    <div class="kpi-toggle-row"><button id="kpiToggleBtn" class="btn btn-small">Voir plus</button></div>
    <div class="kpi-grid-row" id="kpiMoreRow" style="display:none">${othersHtml}</div>
  `;

  document.getElementById('kpiActivite').innerHTML = html;
  document.getElementById('processFlow').innerHTML = '';
  document.getElementById('processFlow').style.display = 'none';

  document.querySelectorAll('.kpi-card[data-kpi-label]').forEach(card => {
    card.addEventListener('click', (event) => {
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
      const label = card.dataset.kpiLabel;
      if (!label) return;
      window.__activeKpiLabel = label;
      document.querySelectorAll('.kpi-card[data-kpi-label]').forEach(item => {
        item.classList.toggle('active', (item.dataset.kpiLabel || '') === label);
      });
    });
  });

  initKpiTooltips();

  const btn = document.getElementById('kpiToggleBtn');
  if (btn) btn.addEventListener('click', () => {
    const more = document.getElementById('kpiMoreRow');
    if (!more) return;
    if (more.style.display === 'none') { more.style.display = ''; btn.textContent = 'Voir moins'; }
    else { more.style.display = 'none'; btn.textContent = 'Voir plus'; }
  });

  renderRetardsStatistics();
}

// ============================================================
// PV DECISION - Fonctions utilitaires
// ============================================================
function getPVDecisionStateMapForDashboard() {
  if (window && typeof window.PV_DECISION_STATE !== 'undefined') {
    return window.PV_DECISION_STATE || {};
  }
  try {
    const raw = localStorage.getItem('pvDecisionState');
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function getPVDecisionValueForDashboard(row) {
  if (typeof window.getPVDecisionValue === 'function') {
    try {
      return window.getPVDecisionValue(row);
    } catch (e) {}
  }

  const stateMap = getPVDecisionStateMapForDashboard();
  const identity = typeof window.getPVRowIdentity === 'function'
    ? window.getPVRowIdentity(row)
    : `${row['numero_da']||''}::${row['fournisseur_retenu']||''}::${row['statut_budget']||''}::${row['designation_commandee']||''}`;

  if (Object.prototype.hasOwnProperty.call(stateMap, identity)) {
    return Boolean(stateMap[identity]);
  }

  if (row && Object.prototype.hasOwnProperty.call(row, 'decision')) {
    return Boolean(row['decision']);
  }

  const statutBudget = String(row['statut_budget'] || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return statutBudget === '✅ budget conforme' || statutBudget === 'budget conforme';
}

// ============================================================
// RETARDS, ALERTES & PV COMITÉ
// ============================================================
function renderRetardsStatistics() {
  const d = getRowsForKpi();
  const isDelivered = row => String(row?.statut || '').trim().toLowerCase() === 'livré';
  const livreCount = d.filter(isDelivered).length;
  const search = document.getElementById('searchRetard')?.value?.trim().toLowerCase() || '';
  const matchesRetardSearch = row => !search ||
    String(row['designation_demandee'] || '').toLowerCase().includes(search) ||
    String(row['numero_da'] || '').toLowerCase().includes(search) ||
    String(row['filiale'] || '').toLowerCase().includes(search);
  const retardRows = d.filter(r => !isDelivered(r) &&
    (r._hasRetard || r._hasAnomalies || r._criticite === 'Très Critique' || isCasExceptionnelRow(r)) &&
    matchesRetardSearch(r));
  const deliveredRows = d.filter(r => isDelivered(r) && matchesRetardSearch(r));
  const activeKpiFilter = window.__activeOperationalKpi;
  const filteredRetardRows = activeKpiFilter
    ? activeKpiFilter.type === 'delivered'
      ? deliveredRows
      : activeKpiFilter.type === 'active'
        ? d.filter(row => !isDelivered(row) && String(row['statut'] || '').trim().toLowerCase() !== 'annulé' && matchesRetardSearch(row))
      : activeKpiFilter.type === 'committeePending'
        ? d.filter(row => isOperationalCommitteePendingRow(row) && matchesRetardSearch(row))
      : activeKpiFilter.type === 'bcSigning'
        ? d.filter(row => isBCSignatureInProgressRow(row) && matchesRetardSearch(row))
      : retardRows.filter(row => {
        if (activeKpiFilter.type === 'crit') return getEffectiveDashboardCriticite(row) === activeKpiFilter.value;
        if (activeKpiFilter.type === 'cas') return isCasExceptionnelRow(row);
        if (activeKpiFilter.type === 'step') return row._retards?.some(item => item.type === activeKpiFilter.value);
        if (activeKpiFilter.type === 'anomaly') return row._anomalies?.some(item => item.type === activeKpiFilter.value);
        return true;
      })
    : retardRows;
  const retardTypes = ['Consultation','Envoi TCO','Validation Filiale','Validation Comité','Signature BC','Livraison'];
  const retardCounts = {};
  retardTypes.forEach(t => retardCounts[t] = 0);
  const anomalyCounts = {};
  d.forEach(r => {
    if (retardRows.includes(r) && !r._hasAnomalies && r._retards.length > 0) {
      r._retards.forEach(retard => {
        if (retardCounts[retard.type] !== undefined) retardCounts[retard.type]++;
      });
    }
    r._anomalies.forEach(a => { anomalyCounts[a.type] = (anomalyCounts[a.type]||0) + 1; });
  });
  const anomalyTypes = Object.keys(anomalyCounts).sort();
  const critCounts = {'Normal':0,'Attention':0,'Critique':0,'Très Critique':0};
  retardRows.forEach(r => {
    const effectiveCrit = getEffectiveDashboardCriticite(r);
    critCounts[effectiveCrit] = (critCounts[effectiveCrit]||0)+1;
  });
  const critHeaders = ['Normal','Attention','Critique','Très Critique'];
  const hiddenCritHeaders = new Set(['Attention','Critique']);
  const visibleCritHeaders = critHeaders.filter(h => !hiddenCritHeaders.has(h));
  const critClass = {'Normal':'kpi-green','Attention':'kpi-yellow','Critique':'kpi-orange','Très Critique':'kpi-red'};
  const hiddenRetardSteps = new Set(['Consultation','Validation Filiale','Signature BC','Livraison']);
  const visibleRetardTypes = retardTypes.filter(t => !hiddenRetardSteps.has(t));

  const critHtml = visibleCritHeaders.map(h => `
    <div class="kpi-card ${h==='Très Critique'?'red':h==='Critique'?'orange':h==='Attention'?'yellow':'green'}" onclick="window.__showRetardByCrit('${h}')">
      <div class="kpi-label">${h}</div>
      <div class="kpi-value">${critCounts[h]||0}</div>
      <div class="kpi-sub">${h === 'Normal' ? '✅' : h === 'Très Critique' ? '🚨' : h === 'Critique' ? '⚠️' : '⚡'}</div>
    </div>
  `).join('');

  const retardHtml = visibleRetardTypes.map(t => `
    <div class="kpi-card" onclick="window.__showRetardByStep('${t}')">
      <div class="kpi-label">${t}</div>
      <div class="kpi-value">${retardCounts[t]||0}</div>
      <div class="kpi-sub"></div>
    </div>
  `).join('');

  const pvRows = (typeof window.getEligibleForPV === 'function' && typeof window.groupPVDossiers === 'function' && typeof window.aggregateFieldsPV === 'function')
    ? window.groupPVDossiers(window.getEligibleForPV()).map(group => window.aggregateFieldsPV(group))
    : d.filter(r => String(r['pv_numero'] || '').trim());
  const pvValidCount = pvRows.filter(r => getPVDecisionValueForDashboard(r)).length;
  const pvTotal = pvRows.length;
  const pvValidPercent = pvTotal ? Math.round((pvValidCount / pvTotal) * 100) : 0;
  const pvInvalidCount = pvTotal - pvValidCount;
  const pvInvalidPercent = pvTotal ? Math.round((pvInvalidCount / pvTotal) * 100) : 0;

  const pvBudgetTotal = pvRows.reduce((sum, r) => sum + (Number(r['montant_budget']) || 0), 0);
  const pvHtTotal = pvRows.reduce((sum, r) => sum + (Number(r['montant_ht']) || 0), 0);
  const pvEcart = pvBudgetTotal - pvHtTotal;
  const pvEcartPct = pvHtTotal ? Math.round((pvEcart / pvHtTotal) * 100) : 0;
  const anomalyList = anomalyTypes.length ? anomalyTypes : [];
  const anomalyHtml = anomalyList.length ? anomalyList.map(t => `
    <div class="kpi-card" onclick="window.__showRetardByAnomaly('${t.replace(/'/g, "\\'")}')">
      <div class="kpi-label">${t}</div>
      <div class="kpi-value">${anomalyCounts[t]||0}</div>
      <div class="kpi-sub">🔍</div>
    </div>
  `).join('') : `<div class="no-data">Aucune anomalie détectée</div>`;

  document.getElementById('statsRetard').innerHTML = `
    <div class="kpi-section">
      <div class="kpi-grid-row kpi-grid-row-5">
        ${kpiCard('En attente comité', d.filter(isOperationalCommitteePendingRow).length, '', '', { tooltip: false, onClick: "window.__showRetardByCommitteePending()" })}
        ${kpiCard('Livré', livreCount, '', '', { tooltip: false, onClick: "window.__showRetardByDelivered()" })}
        ${kpiCard('BC en cours de signature', d.filter(isBCSignatureInProgressRow).length, '', '', { tooltip: false, onClick: "window.__showRetardByBCSigning()" })}
        ${kpiCard('Cas exceptionnel', retardRows.filter(isCasExceptionnelRow).length, '', '', { tooltip: false, onClick: "window.__showRetardByCasExceptionnel()" })}
        ${kpiCard('Livraison retard', retardRows.filter(r => r._retards?.some(x => x.type === 'Livraison')).length, '', '', { tooltip: false, onClick: "window.__showRetardByStep('Livraison')" })}
        ${kpiCard('Validation Filiale avant TCO', retardRows.filter(r => r._retards?.some(x => x.type === 'Validation Filiale')).length, '', '', { tooltip: false, onClick: "window.__showRetardByStep('Validation Filiale')" })}
        ${kpiCard('BC sans comité', retardRows.filter(r => r._anomalies?.some(a => a.type === 'BC sans Comité')).length, '', '', { tooltip: false, onClick: "window.__showRetardByAnomaly('BC sans Comité')" })}
      </div>
    </div>
  `;

  initKpiTooltips();

  window.__renderRetardRows = function(rows) {
    try {
      const dataRows = rows || [];
      const totalLabel = document.getElementById('retardRowsCount');
      const rightTotal = document.getElementById('retardRowsTotal');
      const totalText = `${dataRows.length} ligne${dataRows.length > 1 ? 's' : ''}`;
      if (totalLabel) totalLabel.textContent = totalText;
      if (rightTotal) rightTotal.textContent = totalText;
      const html = dataRows.map(r => `
        <tr onclick="openModal(${r._idx})" style="cursor:pointer">
          <td>${r['numero_da']||'—'}</td>
          <td title="${(r['designation_demandee']||'')}">${(r['designation_demandee']||r['designation_commandee']||'—').slice(0,40)}</td>
          <td>${r['filiale']||'—'}</td>
          <td>${r['acheteur']||'—'}</td>
          <td>${statutBadge(r['statut'])}</td>
          <td>${critBadge(r._criticite)}</td>
          <td>${r._retards.map(x=>x.type).join(', ')||'—'}</td>
          <td style="color:var(--red);font-weight:700">${r._joursRetard > 0 ? r._joursRetard + 'j' : '—'}</td>
          <td>${r._anomalies.map(a => `<span class="badge badge-${a.criticite.toLowerCase().replace(' ', '-')}">${a.type.slice(0,25)}</span>`).join('<br>')||'—'}</td>
          <td>${prioBadge(r['priorite'])}</td>
        </tr>
      `).join('') || '<tr><td colspan="10" class="no-data">Aucun retard ou anomalie détecté</td></tr>';
      document.getElementById('tbodyRetard').innerHTML = html;
    } catch (e) { document.getElementById('tbodyRetard').innerHTML = '<tr><td colspan="10" class="no-data">Erreur rendu</td></tr>'; }
  };

  window.__showRetardByCrit = function(crit) {
    window.__activeOperationalKpi = { type: 'crit', value: crit };
    renderRetardsStatistics();
  };
  window.__showRetardByStep = function(step) {
    window.__activeOperationalKpi = { type: 'step', value: step };
    renderRetardsStatistics();
  };
  window.__showRetardByAnomaly = function(anom) {
    window.__activeOperationalKpi = { type: 'anomaly', value: anom };
    renderRetardsStatistics();
  };
  window.__showRetardByCasExceptionnel = function() {
    window.__activeOperationalKpi = { type: 'cas' };
    renderRetardsStatistics();
  };
  window.__showRetardByDelivered = function() {
    window.__activeOperationalKpi = { type: 'delivered' };
    renderRetardsStatistics();
  };
  window.__showRetardByActive = function() {
    window.__activeOperationalKpi = { type: 'active' };
    renderRetardsStatistics();
  };
  window.__showRetardByCommitteePending = function() {
    window.__activeOperationalKpi = { type: 'committeePending' };
    renderRetardsStatistics();
  };
  window.__showRetardByBCSigning = function() {
    window.__activeOperationalKpi = { type: 'bcSigning' };
    renderRetardsStatistics();
  };

  window.__renderRetardRows(filteredRetardRows);
  initKpiTooltips();
}

function filterRetardTable() { 
  renderRetardsStatistics(); 
}

// ============================================================
// EXPOSITION DES FONCTIONS GLOBALEMENT
// ============================================================
window.redirectToAchatWithFilters = redirectToAchatWithFilters;
window.setupTooltipRowClick = setupTooltipRowClick;
window.handleTooltipRowClick = handleTooltipRowClick;
window.getTooltipRows = getTooltipRows;
window.tooltipTableFor = tooltipTableFor;
window.initKpiTooltips = initKpiTooltips;
window.kpiCard = kpiCard;
window.renderDashboard = renderDashboard;
window.getPVDecisionValueForDashboard = getPVDecisionValueForDashboard;
window.renderRetardsStatistics = renderRetardsStatistics;
window.filterRetardTable = filterRetardTable;