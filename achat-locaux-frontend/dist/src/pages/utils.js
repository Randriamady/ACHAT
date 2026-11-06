// ============================================================
// UTILS – Fonctions partagées (variables globales, date, calculs, filtres, switchTab)
// ============================================================

// Variables globales
var ALL_DATA = [];
var FILTERED = [];
var currentPage = 1;
var PAGE_SIZE = 500;
var sortKey = null, sortAsc = true;
var charts = {};
// Flag pour empêcher le rafraîchissement en arrière-plan pendant la pagination
if (typeof window !== 'undefined' && !window.__paging_in_progress) {
  window.__paging_in_progress = false;
}

// Etat de la barre de filtre (affichage / réduction)
// Repliée par défaut : elle reste disponible sur tous les onglets (acheteur, filiale,
// dept, dossiers, etc.) mais ne s'affiche qu'après un double-clic sur un onglet.
var filterBarCollapsed = true;
var FILTER_IDS = ['fAcheteur','fFiliale','fDept','fPriorite','fCircuit','fAnomalies','fPv','fCriticite','fRetard','fCatRetard','fMois','fAnnee'];
// Préfixe utilisé pour stocker un état de filtres DIFFÉRENT pour chaque onglet
// (achatsFilterState_dashboard, achatsFilterState_dossiers, achatsFilterState_financier, ...)
var FILTER_STATE_KEY_PREFIX = 'achatsFilterState_';
// Conservé pour compatibilité ascendante (ancien format global, plus utilisé pour écrire)
var FILTER_STATE_KEY = 'achatsFilterState';
var ACTIVE_TAB_KEY = 'achatsActiveTab';

// Cache pour les données des onglets
var TAB_CACHE = {
  data: {},
  lastUpdate: {},
  rendered: {}
};

// Gestion du rechargement en cours
var IS_REFRESHING = false;
// Si un changement d'onglet demande un rafraîchissement pendant qu'un autre
// rafraîchissement est déjà en cours, on le met en attente pour ne jamais le perdre
var PENDING_TAB_REFRESH = false;

// Retourne l'identifiant de l'onglet actuellement affiché (ex: 'dashboard', 'dossiers'...)
function getActiveTab() {
  const el = document.querySelector('.tab-content.active');
  if (el && el.id) return el.id.replace('tab-', '');
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY) || 'dashboard';
  } catch (err) {
    return 'dashboard';
  }
}

// Construit la clé localStorage dédiée aux filtres d'un onglet donné
function filterStateKeyForTab(tab) {
  const safeTab = tab || getActiveTab();
  return FILTER_STATE_KEY_PREFIX + safeTab;
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function isExactFilterMatch(value, expected) {
  if (expected === undefined || expected === null || expected === '') return true;
  return normalizeSearchText(value) === normalizeSearchText(expected);
}

function hasFilterValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== '' && value !== undefined && value !== null;
}

function getFilterState() {
  return FILTER_IDS.map(id => {
    const el = document.getElementById(id);
    return { id, value: el?.multiple
      ? Array.from(el.selectedOptions).map(option => option.value).filter(Boolean)
      : (el ? el.value : '') };
  });
}
function saveFilterState(tab) {
  try {
    const searchInput = document.getElementById('pvFilterInput');
    const payload = {
      filters: getFilterState(),
      search: searchInput ? searchInput.value : ''
    };
    localStorage.setItem(filterStateKeyForTab(tab), JSON.stringify(payload));
  } catch (err) {
    console.error('Impossible de sauvegarder l\'état des filtres :', err);
  }
}

function restoreSearchState(searchValue) {
  const searchInput = document.getElementById('pvFilterInput');
  if (searchInput && typeof searchValue === 'string') {
    searchInput.value = searchValue;
  }
}
function loadFilterState(tab) {
  try {
    const stored = localStorage.getItem(filterStateKeyForTab(tab));
    if (!stored) return { filters: [], search: '' };
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return {
        filters: parsed.filter(item => item && typeof item.id === 'string' && (typeof item.value === 'string' || Array.isArray(item.value))),
        search: ''
      };
    }
    if (parsed && typeof parsed === 'object') {
      return {
        filters: Array.isArray(parsed.filters)
          ? parsed.filters.filter(item => item && typeof item.id === 'string' && (typeof item.value === 'string' || Array.isArray(item.value)))
          : [],
        search: typeof parsed.search === 'string' ? parsed.search : ''
      };
    }
    return { filters: [], search: '' };
  } catch (err) {
    console.error('Impossible de charger l\'état des filtres :', err);
    return { filters: [], search: '' };
  }
}
function restoreFilterState(state) {
  if (!Array.isArray(state)) return;
  state.forEach(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.multiple) {
      const selected = new Set(Array.isArray(value) ? value : (value ? [value] : []));
      Array.from(el.options).forEach(option => { option.selected = selected.has(option.value); });
      return;
    }
    if (Array.from(el.options).some(opt => opt.value === value)) {
      el.value = value;
    } else {
      el.value = '';
    }
  });
}

// Recharge dans la barre de filtres (partagée visuellement) les valeurs propres
// à l'onglet demandé, afin que chaque page conserve ses propres filtres et sa
// propre recherche, indépendamment des autres onglets.
function restoreTabFilters(tab) {
  const stored = loadFilterState(tab);
  const filters = Array.isArray(stored) ? stored : (stored.filters || []);
  const search = typeof stored.search === 'string' ? stored.search : '';
  if (filters.length && filters.some(f => hasFilterValue(f.value))) {
    restoreFilterState(filters);
  } else {
    // Aucun filtre sauvegardé pour cet onglet : on repart d'une barre vide
    restoreFilterState(FILTER_IDS.map(id => ({ id, value: '' })));
  }
  restoreSearchState(search);
}

// Recalcule FILTERED uniquement à partir des filtres actuellement affichés
// (qui, grâce à restoreTabFilters, correspondent à l'onglet actif) sans toucher
// aux filtres des autres onglets ni les sauvegarder.
function refreshFilteredDataFromAllData() {
  if (typeof getAchatFilterState !== 'function' || typeof doesRowMatchAchatFilters !== 'function') {
    FILTERED = [...ALL_DATA];
    currentPage = 1;
    return FILTERED;
  }

  const filters = getAchatFilterState();
  const hasAnyFilterValue = getActiveTab() === 'dossiers' || Object.values(filters).some(hasFilterValue);
  FILTERED = hasAnyFilterValue
    ? ALL_DATA.filter(r => doesRowMatchAchatFilters(r, filters))
    : [...ALL_DATA];
  currentPage = 1;
  return FILTERED;
}

function applyStoredFiltersForTab() {
  refreshFilteredDataFromAllData();
}

// ----- Utilitaires de date -----
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const year = v.getFullYear();
    return !Number.isNaN(v.getTime()) && year >= 1 && year <= 9999 ? new Date(v.getTime()) : null;
  }
  const s = String(v).trim();
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  let year, month, day;
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10);
    day = parseInt(isoMatch[3], 10);
  } else {
    const localMatch = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);
    if (!localMatch) return null;
    day = parseInt(localMatch[1], 10);
    month = parseInt(localMatch[2], 10);
    year = parseInt(localMatch[3], 10);
    if (year < 100) year += 2000;
  }
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}
function getYearMonth(dateStr) {
  if (!dateStr) return null;
  const d = parseDate(dateStr);
  if (!d) return null;
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function getYear(dateStr) {
  const d = parseDate(dateStr);
  return d ? String(d.getFullYear()) : null;
}
function nextComiteDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  const day = d.getDay();
  if (day === 2 || day === 5) return d;
  let add;
  if ([5,6,0,1].includes(day)) add = (2 - day + 7) % 7 || 7;
  else add = (5 - day + 7) % 7 || 7;
  const next = new Date(d);
  next.setDate(next.getDate() + add);
  return next;
}
function dateToString(d) {
  if (!d) return null;
  let dateObj = d;
  if (typeof d === 'string') {
    const parsed = parseDate(d);
    if (!parsed) return d;
    dateObj = parsed;
  }
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}/${month}/${year}`;
}

// Circuit B
const CIRCUIT_B_DELAIS = ['25% commande + 75% livraison','30% commande + 70% livraison',
  '50% commande + 50% livraison','70% commande + 30% livraison','75% commande + 25% livraison',
  'A la commande','Au comptant'];
function isCircuitB(row) {
  return CIRCUIT_B_DELAIS.includes(row['delai_paiement']);
}

// Calcul des étapes et retards
function computeStepDelays(row) {
  const now = new Date();
  const statut = (row['statut'] || '').toLowerCase();
  if (statut === 'annulé') return [];
  const isB = isCircuitB(row);
  let steps;
  if (isB) {
    steps = [
      {name:'Consultation', start:'date_reception_physique', end:'date_envoi_consultation', max:24},
      {name:'Envoi TCO', start:'date_envoi_consultation', end:'date_envoi_tco', max:72},
      {name:'Validation Filiale', start:'date_envoi_tco', end:'date_valid_filiale', max:24},
      {name:'Validation Comité', start:'date_valid_filiale', end:'date_valid_comite', isComite:true},
      {name:'Signature BC', start:'date_valid_comite', end:'date_envoi_bc', max:24},
      {name:'Contrôle de Gestion', start:'date_envoi_bc', end:'date_envoi_cdg', max:48},
      {name:'Paiement', start:'date_envoi_cdg', end:'date_paiement', max:72},
      {name:'Livraison', start:'date_paiement', end:'date_prevue_livraison', max:72}
    ];
  } else {
    steps = [
      {name:'Consultation', start:'date_reception_physique', end:'date_envoi_consultation', max:24},
      {name:'Envoi TCO', start:'date_envoi_consultation', end:'date_envoi_tco', max:72},
      {name:'Validation Filiale', start:'date_envoi_tco', end:'date_valid_filiale', max:24},
      {name:'Validation Comité', start:'date_valid_filiale', end:'date_valid_comite', isComite:true},
      {name:'Signature BC', start:'date_valid_comite', end:'date_envoi_bc', max:24},
      {name:'Livraison', start:'date_envoi_bc', end:'date_prevue_livraison', max:72}
    ];
  }
  return steps.map(s => {
    const dStart = parseDate(row[s.start]);
    if (!dStart) return {name:s.name, heures:null, retard:false, raison:'non démarré'};
    const dEnd = parseDate(row[s.end]) || now;
    let h = (dEnd - dStart) / 3600000;
    let retard = false, raison = 'ok';
    if (s.isComite) {
      const nextC = nextComiteDate(row[s.start]);
      if (nextC) { h = (dEnd - nextC) / 3600000; if (dEnd > nextC) {retard=true; raison=Math.round(h)+'h retard';} }
    } else {
      if (h > s.max) {retard=true; raison=Math.round(h)+'h > '+s.max+'h';}
    }
    return {name:s.name, heures:Math.round(h*10)/10, jours:Math.round(h/24*10)/10, retard, raison};
  });
}
function computeRetards(row) {
  return computeStepDelays(row).filter(s => s.retard).map(s => ({type:s.name, heures:s.heures}));
}
function computeCriticite(row, retards) {
  const prio = (row['priorite'] || '').toUpperCase();
  if (prio === 'TRES URGENT') return 'Très Critique';
  if (retards.length > 0) {
    const maxH = Math.max(...retards.map(r => r.heures));
    if (maxH > 168) return 'Très Critique';
    return 'Critique';
  }
  const now = new Date();
  const consultDate = parseDate(row['date_envoi_consultation']);
  if (consultDate) {
    const ageH = (now - consultDate) / 3600000;
    if (ageH > 48 && !row['date_envoi_tco']) return 'Attention';
  }
  return 'Normal';
}
function computeAnomalies(row) {
  const anomalies = [];
  const hasDate = (f) => !!parseDate(row[f]);
  const isDateBefore = (d1,d2) => {
    const a = parseDate(row[d1]), b = parseDate(row[d2]);
    if (!a || !b) return false;
    return a < b;
  };
  if (hasDate('date_envoi_tco') && !hasDate('date_envoi_consultation')) anomalies.push({type:'TCO sans Consultation', criticite:'Critique'});
  if (hasDate('date_valid_filiale') && !hasDate('date_envoi_tco')) anomalies.push({type:'Valid.Filiale sans TCO', criticite:'Critique'});
  if (hasDate('date_valid_comite') && !hasDate('date_valid_filiale')) anomalies.push({type:'Valid.Comité sans Valid.Filiale', criticite:'Critique'});
  if (hasDate('date_envoi_bc') && !hasDate('date_valid_comite')) anomalies.push({type:'BC sans Comité', criticite:'Critique'});
  if (isCircuitB(row)) {
    if (hasDate('date_envoi_cdg') && !hasDate('date_envoi_bc')) anomalies.push({type:'CDG sans BC', criticite:'Critique'});
    if (hasDate('date_paiement') && !hasDate('date_envoi_cdg')) anomalies.push({type:'Paiement sans CDG', criticite:'Critique'});
  }
  if (hasDate('date_prevue_livraison')) {
    if (isCircuitB(row) && !hasDate('date_paiement')) anomalies.push({type:'Livraison sans Paiement (B)', criticite:'Critique'});
    else if (!isCircuitB(row) && !hasDate('date_envoi_bc')) anomalies.push({type:'Livraison sans BC (A)', criticite:'Critique'});
  }
  if (isDateBefore('date_envoi_tco','date_envoi_consultation')) anomalies.push({type:'TCO avant Consultation', criticite:'Attention'});
  if (isDateBefore('date_valid_filiale','date_envoi_tco')) anomalies.push({type:'Valid.Filiale avant TCO', criticite:'Attention'});
  if (isDateBefore('date_valid_comite','date_valid_filiale')) anomalies.push({type:'Valid.Comité avant Filiale', criticite:'Attention'});
  if (isDateBefore('date_envoi_bc','date_valid_comite')) anomalies.push({type:'BC avant Comité', criticite:'Attention'});
  if (isCircuitB(row)) {
    if (isDateBefore('date_envoi_cdg','date_envoi_bc')) anomalies.push({type:'CDG avant BC', criticite:'Attention'});
    if (isDateBefore('date_paiement','date_envoi_cdg')) anomalies.push({type:'Paiement avant CDG', criticite:'Critique'});
    if (isDateBefore('date_prevue_livraison','date_paiement')) anomalies.push({type:'Livraison avant Paiement', criticite:'Critique'});
  } else {
    if (isDateBefore('date_prevue_livraison','date_envoi_bc')) anomalies.push({type:'Livraison avant BC', criticite:'Critique'});
  }
  return anomalies;
}
function buildSearchText(row) {
  if (!row || typeof row !== 'object') return '';
  const values = [
    row['numero_da'], row['designation_demandee'], row['designation_commandee'],
    row['fournisseur_retenu'], row['filiale'], row['acheteur'], row['departement_demandeur'],
    row['code_budget'], row['pv_numero'], row['obs'], row['statut'], row['type_paiement'],
    row['delai_paiement']
  ];
  return values.filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function enrichData(rows) {
  return rows.map((r, i) => {
    const stepDelays = computeStepDelays(r);
    const retards = computeRetards(r);
    const criticite = computeCriticite(r, retards);
    const joursRetard = retards.length ? Math.round(Math.max(...retards.map(x => x.heures)) / 24) : 0;
    const anomalies = computeAnomalies(r);
    return {
      ...r,
      _idx: i,
      _retards: retards,
      _criticite: criticite,
      _joursRetard: joursRetard,
      _hasRetard: retards.length > 0,
      _stepDelays: stepDelays,
      _anomalies: anomalies,
      _hasAnomalies: anomalies.length > 0,
      _searchText: buildSearchText(r)
    };
  });
}

// ----- Formatage -----
function formatDisplayNumber(value, dec=0) {
  if (value === null || value === undefined || value === '') return '';
  const numericValue = typeof value === 'number'
    ? value
    : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (Number.isNaN(numericValue)) return '';
  const fixed = numericValue.toFixed(dec);
  const [whole, fraction = ''] = fixed.split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction ? `${groupedWhole},${fraction}` : groupedWhole;
}
function fmtNum(n, dec=0) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return formatDisplayNumber(n, dec);
}
function fmtDate(d) {
  if (!d) return '—';
  if (d instanceof Date) {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  const s = String(d).trim();
  const parsed = parseDate(s);
  if (parsed) {
    return `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${parsed.getFullYear()}`;
  }
  return s;
}
function normalizeDateFormat(d) {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const m2 = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m2) {
    const mo = parseInt(m2[1]), da = parseInt(m2[2]), y = parseInt(m2[3]);
    const year = y < 100 ? 2000 + y : y;
    if (mo > 12) return `${year}-${String(da).padStart(2,'0')}-${String(mo).padStart(2,'0')}`;
    else return `${year}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`;
  }
  return d;
}
if (typeof window !== 'undefined') {
  window.formatDisplayNumber = formatDisplayNumber;
  window.fmtNum = fmtNum;
  window.fmtDate = fmtDate;
}

function critBadge(c) {
  const map = {'Normal':'badge-normal','Attention':'badge-attention','Critique':'badge-critique','Très Critique':'badge-tres-critique'};
  return `<span class="badge ${map[c]||'badge-normal'}">${c||'Normal'}</span>`;
}
function statutBadge(s) {
  if (!s) return '<span class="badge badge-standby">—</span>';
  const cls = s.includes('comité')||s.includes('filiale') ? 'badge-comite' :
    s.includes('Consultation') ? 'badge-consultation' :
    s.includes('signature') ? 'badge-bc-sign' :
    s.includes('transmis') ? 'badge-bc-trans' :
    s.includes('Livré') ? 'badge-livr' :
    s.includes('Stand') ? 'badge-standby' : 'badge-attente';
  return `<span class="badge ${cls}">${s}</span>`;
}
function prioBadge(p) {
  if (!p) return '';
  return `<span class="badge badge-urgent">${p}</span>`;
}

// ----- Filtres (avec sécurisation DOM) -----
function updatePvFilterOptions(values) {
  const select = document.getElementById('fPv');
  const optionsContainer = document.getElementById('pvFilterOptions');
  if (!select || !optionsContainer) return;

  const selected = new Set(Array.from(select.selectedOptions).map(option => option.value).filter(Boolean));
  select.innerHTML = '<option value="">Tous les N°PV</option>';
  optionsContainer.innerHTML = '';

  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = selected.has(value);
    select.appendChild(option);

    const label = document.createElement('label');
    label.className = 'pv-filter-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = value;
    checkbox.checked = selected.has(value);
    checkbox.onchange = () => togglePvFilterOption(checkbox);
    label.append(checkbox, ` ${value}`);
    optionsContainer.appendChild(label);
  });
  updatePvFilterTrigger();
}

function updatePvFilterTrigger() {
  const select = document.getElementById('fPv');
  const trigger = document.getElementById('pvFilterTrigger');
  if (!select || !trigger) return;
  const selectedCount = Array.from(select.selectedOptions).filter(option => option.value).length;
  trigger.textContent = selectedCount ? `N°PV (${selectedCount})` : 'Tous les N°PV';
  trigger.classList.toggle('filter-active', selectedCount > 0);
}

function togglePvFilterMenu(event) {
  event?.stopPropagation();
  const dropdown = document.getElementById('pvFilterDropdown');
  const trigger = document.getElementById('pvFilterTrigger');
  const menu = document.getElementById('pvFilterMenu');
  if (!dropdown || !trigger || !menu) return;

  const isOpen = dropdown.classList.toggle('open');
  if (isOpen) {
    const rect = trigger.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
  }
}

function togglePvFilterOption(checkbox) {
  const select = document.getElementById('fPv');
  if (!select) return;
  if (!checkbox.value) {
    Array.from(select.options).forEach(option => { option.selected = false; });
    document.querySelectorAll('#pvFilterOptions input[type="checkbox"]').forEach(input => { input.checked = false; });
  } else {
    const option = Array.from(select.options).find(item => item.value === checkbox.value);
    if (option) option.selected = checkbox.checked;
    const allOption = document.querySelector('#pvFilterDropdown > .pv-filter-option input');
    if (allOption) allOption.checked = false;
  }
  updatePvFilterTrigger();
  applyFilters();
}

document.addEventListener('pointerdown', event => {
  const dropdown = document.getElementById('pvFilterDropdown');
  if (dropdown && !dropdown.contains(event.target)) dropdown.classList.remove('open');
}, true);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    document.getElementById('pvFilterDropdown')?.classList.remove('open');
  }
});

function populateFilters() {
  const unique = (key) => [...new Set(ALL_DATA.map(r => r[key]).filter(Boolean))].sort();
  const fill = (id, vals) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    if (sel.multiple) {
      const current = new Set(Array.from(sel.selectedOptions).map(option => option.value).filter(Boolean));
      sel.innerHTML = '<option value="">Tous les N°PV</option>' + vals.map(v => `<option value="${v}">${v}</option>`).join('');
      Array.from(sel.options).forEach(option => { option.selected = current.has(option.value); });
      return;
    }
    const cur = sel.value;
    const first = sel.options[0].outerHTML;
    const options = vals.includes(cur) || !cur ? vals : [cur, ...vals];
    sel.innerHTML = first + options.map(v => `<option value="${v}">${v}</option>`).join('');
    sel.value = cur;
  };
  fill('fAcheteur', unique('acheteur'));
  fill('fFiliale', unique('filiale'));
  fill('fDept', unique('departement_demandeur'));
  fill('fPriorite', unique('priorite'));
  updatePvFilterOptions([...new Set(ALL_DATA.map(r => String(r.pv_numero || '').trim()).filter(Boolean))].sort());
  const catRetards = [...new Set(ALL_DATA.flatMap(r => (r._stepDelays || []).filter(s => s.retard).map(s => s.name)).filter(Boolean))].sort();
  const rSel = document.getElementById('fCatRetard');
  if (rSel) {
    const cur = rSel.value;
    const rf = rSel.options[0].outerHTML;
    const options = catRetards.includes(cur) || !cur ? catRetards : [cur, ...catRetards];
    rSel.innerHTML = rf + options.map(v => `<option value="${v}">${v}</option>`).join('');
    rSel.value = cur;
  }
  const years = [...new Set(ALL_DATA.map(r => getYear(r['date'])).filter(Boolean))].sort().reverse();
  const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  fill('fAnnee', years);
  const mSel = document.getElementById('fMois');
  if (mSel) {
    const cur = mSel.value;
    const mf = mSel.options[0].outerHTML;
    mSel.innerHTML = mf + months.map((m,i) => `<option value="${m}">${monthNames[i]}</option>`).join('');
    if (months.includes(cur)) mSel.value = cur;
  }
}
function applyFilters() {
  saveFilterState(getActiveTab());
  updateActiveFilterStyles();
  const filters = getAchatFilterState();
  const hasAnyFilterValue = getActiveTab() === 'dossiers' || Object.values(filters).some(hasFilterValue);

  try {
    if (window && window.__USE_PAGED_MODE) {
      // En mode lazy-load on ne refait pas un rechargement complet du serveur
      // pour chaque filtre. On filtre simplement les lignes déjà chargées,
      // ce qui évite le ralentissement et conserve le comportement attendu.
      FILTERED = hasAnyFilterValue
        ? ALL_DATA.filter(r => doesRowMatchAchatFilters(r, filters))
        : [...ALL_DATA];
      currentPage = 1;
      if (typeof populateFilters === 'function') populateFilters();
      if (typeof render === 'function') render();
      return;
    }
  } catch (e) { /* ignore */ }

  FILTERED = hasAnyFilterValue
    ? ALL_DATA.filter(r => doesRowMatchAchatFilters(r, filters))
    : [...ALL_DATA];
  currentPage = 1;
  render();
}

function updateActiveFilterStyles() {
  const filterIds = ['fPv', 'fAcheteur', 'fFiliale', 'fDept', 'fPriorite', 'fCircuit', 'fAnomalies', 'fCriticite', 'fRetard', 'fCatRetard', 'fMois', 'fAnnee'];
  filterIds.forEach(id => {
    const field = document.getElementById(id);
    if (!field) return;
    const active = field.multiple
      ? Array.from(field.selectedOptions).some(option => option.value)
      : Boolean(field.value);
    field.classList.toggle('filter-active', active);
  });
}

function getAchatFilterState() {
  const get = id => {
    const el = document.getElementById(id);
    return el ? el.value : '';
  };
  const searchInput = document.getElementById('pvFilterInput');
  return {
    acheteur: get('fAcheteur'),
    filiale: get('fFiliale'),
    dept: get('fDept'),
    prio: get('fPriorite'),
    crit: get('fCriticite'),
    retard: get('fRetard'),
    catRetard: get('fCatRetard'),
    circuit: get('fCircuit'),
    anomalies: get('fAnomalies'),
    pv: (() => {
      const select = document.getElementById('fPv');
      return select?.multiple
        ? Array.from(select.selectedOptions).map(option => option.value).filter(Boolean)
        : get('fPv');
    })(),
    mois: get('fMois'),
    annee: get('fAnnee'),
    searchTerm: normalizeSearchText(searchInput ? searchInput.value : '')
  };
}

function doesRowMatchAchatFilters(r, filters) {
  if (!r || !filters) return true;
  if (filters.acheteur && !isExactFilterMatch(r['acheteur'], filters.acheteur)) return false;
  if (filters.filiale && !isExactFilterMatch(r['filiale'], filters.filiale)) return false;
  if (filters.dept && !isExactFilterMatch(r['departement_demandeur'], filters.dept)) return false;
  if (filters.prio && !isExactFilterMatch(r['priorite'], filters.prio)) return false;
  if (filters.circuit === 'A' && isCircuitB(r)) return false;
  if (filters.circuit === 'B' && !isCircuitB(r)) return false;
  if (filters.crit && !isExactFilterMatch(r._criticite, filters.crit)) return false;
  if (filters.anomalies === '0' && r._hasAnomalies) return false;
  if (filters.anomalies === '1' && !r._hasAnomalies) return false;
  const selectedPv = Array.isArray(filters.pv) ? filters.pv : (filters.pv ? [filters.pv] : []);
  if (selectedPv.length && !selectedPv.some(pv => isExactFilterMatch(r.pv_numero, pv))) return false;
  if (filters.retard === '1' && !r._hasRetard) return false;
  if (filters.catRetard && (!r._stepDelays || !r._stepDelays.some(s => s.retard && isExactFilterMatch(s.name, filters.catRetard)))) return false;
  if (filters.annee && getYear(r['date']) !== filters.annee) return false;
  const ym = getYearMonth(r['date']);
  if (filters.mois && ym && ym.slice(5,7) !== filters.mois) return false;
  if (filters.searchTerm) {
    if (!isExactFilterMatch(r['pv_numero'], filters.searchTerm)) return false;
  }
  return true;
}

function applyFiltersToCache() {
  refreshFilteredDataFromAllData();
  render();
}

function resetFilters() {
  FILTER_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  saveFilterState(getActiveTab());
  FILTERED = [...ALL_DATA];
  const filterCountEl = document.getElementById('filterCount');
  if (filterCountEl) filterCountEl.textContent = '';
  currentPage = 1;
  render();
}
function showToast(msg, variant=false) {
  const t = document.createElement('div');
  const isError = variant === true || variant === 'error';
  t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${isError?'var(--red)':'var(--green)'};color:white;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.4);transition:opacity .3s;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ----- Barre de filtre : affichage / masquage façon Excel -----
function isPersistentFilterBarTab(tab) {
  return tab === 'dossiers' || tab === 'dashboard';
}

function applyFilterBarState() {
  const controls = document.getElementById('filterBarControls');
  const shouldCollapse = !isPersistentFilterBarTab(getActiveTab()) && filterBarCollapsed;
  if (controls) controls.classList.toggle('collapsed', shouldCollapse);
}
function expandFilterBarOnDblClick(e) {
  if (!e.target.closest('.nav-tab')) return;
  filterBarCollapsed = false;
  applyFilterBarState();
}

function updateFilterBarVisibility(tab) {
  const filterBar = document.getElementById('filterBar');
  if (!filterBar) return;
  const isUseful = tab === 'dashboard';
  filterBar.classList.toggle('tab-hidden', !isUseful);
}

// Les filtres restent inchanges et actifs lorsqu'ils sont disponibles.
function manageFiltersForTab(tab) {
  FILTER_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Restaurer une éventuelle valeur mise de côté par un ancien comportement
    try {
      if (el.dataset && typeof el.dataset._prev !== 'undefined') {
        if (!el.value) el.value = el.dataset._prev;
        delete el.dataset._prev;
      }
    } catch (e) {}
    el.classList.remove('tab-hidden');
    el.disabled = false;
  });
}

// ----- Onglets (version optimisée SANS rechargement de page) -----
function saveActiveTab(tab) {
  try {
    localStorage.setItem(ACTIVE_TAB_KEY, tab);
  } catch (err) {
    console.error('Impossible de sauvegarder l\'onglet actif :', err);
  }
}

function getTabTitle(tab) {
  const titles = {
    'dashboard': 'Tableau de bord',
    'retards': 'Retards',
    'dossiers': 'Dossiers',
    'qualite': 'Qualité des données',
    'financier': 'Financier',
    'pv': 'Point de Validation',
    'admin': 'Administration'
  };
  return titles[tab] || tab;
}

function setPVLoadingIndicator(on) {
  const indicator = document.getElementById('pvLoadingIndicator');
  if (indicator) indicator.classList.toggle('visible', Boolean(on));
}

// Nouvelle fonction switchTab optimisée
function switchTab(tab) {
  // 1. Vérification des droits d'accès
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  const role = String(currentUser?.role || '').toLowerCase();
  const normalizedRole = role === 'back office' || role === 'back_office' || role === 'backoffice' ? 'back_office' : role;
  
  if (tab === 'admin' && normalizedRole !== 'admin') {
    showToast('Accès refusé : réservé aux administrateurs', true);
    return;
  }
  if (tab === 'pv' && !['admin', 'validateur'].includes(normalizedRole)) {
    showToast('Accès refusé : réservé aux validateurs et administrateurs', true);
    return;
  }

  // 1b. Sauvegarde des filtres de l'onglet que l'on quitte, pour qu'il retrouve
  // exactement son propre état de filtres la prochaine fois qu'on y revient,
  // indépendamment de l'onglet vers lequel on navigue maintenant.
  const previousTab = getActiveTab();
  if (previousTab && previousTab !== tab) {
    saveFilterState(previousTab);
  }
  
  // 2. Sauvegarde de l'onglet actif
  saveActiveTab(tab);
  setPVLoadingIndicator(tab === 'pv');
  
  // 3. Mise à jour de l'UI (sans rechargement)
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  
  const targetContent = document.getElementById('tab-' + tab);
  if (targetContent) targetContent.classList.add('active');

  updateFilterBarVisibility(tab);
  if (isPersistentFilterBarTab(tab)) filterBarCollapsed = false;
  applyFilterBarState();
  
  const matching = Array.from(document.querySelectorAll('.nav-tab'))
    .find(t => t.getAttribute('onclick') === `switchTab('${tab}')`);
  if (matching) matching.classList.add('active');
  
  // 4. Gestion de la barre de filtre (barre repliée par défaut, cf. filterBarCollapsed ;
  // elle reste fonctionnelle/disponible sur tous les onglets, y compris "dossiers")

  // 4a. Restaurer les filtres propres à ce nouvel onglet (indépendants des autres onglets)
  restoreTabFilters(tab);
  
  // 4b. Masquer ou réinitialiser temporairement certains filtres pour certains onglets
  if (typeof manageFiltersForTab === 'function') manageFiltersForTab(tab);

  // 4c. Recalculer les données filtrées à partir des filtres propres à cet onglet
  applyStoredFiltersForTab();
  
  // 5. Mise à jour du titre de la page
  document.title = `Achats - ${getTabTitle(tab)}`;
  
  // 6. Rechargement intelligent selon l'onglet
  renderTab(tab);
  
  // 7. Rafraîchissement forcé en arrière-plan à CHAQUE changement de page,
  // même si un rafraîchissement était déjà en cours (dans ce cas il est mis
  // en file d'attente et relancé dès que le précédent se termine), puis on
  // ré-affiche l'onglet réellement actif avec ses propres filtres une fois
  // les données à jour.
  requestAnimationFrame(() => forceTabRefresh(tab));
  
  // 8. Mise à jour du cache
  TAB_CACHE.rendered[tab] = true;
  TAB_CACHE.lastUpdate[tab] = Date.now();
}

// Force un rechargement des données en arrière-plan à chaque changement de page.
// Si un rechargement est déjà en cours, on ne le perd pas : on le replanifie pour
// qu'il s'exécute juste après celui en cours, puis on réaffiche l'onglet qui est
// réellement actif au moment où les données arrivent (avec SES propres filtres).
function forceTabRefresh(tab) {
  // L'onglet dossiers utilise un chargement lazy par scroll : on ne doit pas
  // lancer de refresh complet en arrière-plan, sinon la table est rechargée
  // et devient lente. On garde le mécanisme uniquement pour les autres onglets.
  if (tab === 'dossiers') {
    setPVLoadingIndicator(false);
    if (typeof startSilentBackgroundRefresh === 'function') {
      startSilentBackgroundRefresh();
    }
    return;
  }

  const refreshAge = Date.now() - (TAB_CACHE.lastUpdate[tab] || 0);
  if (ALL_DATA.length > 0 && refreshAge < DEFAULT_BACKGROUND_REFRESH_INTERVAL_MS) {
    if (tab === 'pv') {
      setTimeout(() => {
        if (getActiveTab() === 'pv') setPVLoadingIndicator(false);
      }, 350);
    }
    return;
  }

  const runAndRender = () => {
    if (typeof triggerSilentRefresh !== 'function') return;
    if (getActiveTab() !== tab) return;
    triggerSilentRefresh({ force: true }).then(() => {
      const stillActiveTab = getActiveTab();
      if (stillActiveTab !== tab) return;
      restoreTabFilters(stillActiveTab);
      applyStoredFiltersForTab();
      renderTab(stillActiveTab);
    }).catch(err => console.warn('Rafraîchissement forcé impossible :', err));
  };

  try {
    if (IS_REFRESHING) {
      // Un rafraîchissement est déjà en cours : on garantit qu'un autre aura lieu
      // juste après, pour ne jamais ignorer la demande de changement de page.
      PENDING_TAB_REFRESH = true;
      const waitForCurrentRefresh = setInterval(() => {
        if (!IS_REFRESHING) {
          clearInterval(waitForCurrentRefresh);
          if (PENDING_TAB_REFRESH) {
            PENDING_TAB_REFRESH = false;
            runAndRender();
          }
        }
      }, 150);
    } else {
      runAndRender();
    }
    if (typeof startSilentBackgroundRefresh === 'function') {
      startSilentBackgroundRefresh();
    }
  } catch (err) {
    console.warn('Impossible de déclencher le rafraîchissement silencieux :', err);
  }
}

// Nouvelle version de restoreActiveTab (sans reload)
function restoreActiveTab() {
  const tab = localStorage.getItem(ACTIVE_TAB_KEY) || 'dashboard';
  updateFilterBarVisibility(tab);
  
  // Vérification des droits
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  const role = String(currentUser?.role || '').toLowerCase();
  const normalizedRole = role === 'back office' || role === 'back_office' || role === 'backoffice' ? 'back_office' : role;
  
  if (tab === 'admin' && normalizedRole !== 'admin') {
    switchTab('dashboard');
    return;
  }
  if (tab === 'pv' && !['admin', 'validateur'].includes(normalizedRole)) {
    switchTab('dashboard');
    return;
  }
  
  // Appliquer l'onglet sans recharger
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  
  const targetContent = document.getElementById('tab-' + tab);
  if (targetContent) targetContent.classList.add('active');
  
  const matching = Array.from(document.querySelectorAll('.nav-tab'))
    .find(t => t.getAttribute('onclick') === `switchTab('${tab}')`);
  if (matching) matching.classList.add('active');
  
  // Barre de filtre (repliée par défaut, cf. filterBarCollapsed ; disponible sur tous les onglets)

  // Restaurer les filtres propres à cet onglet (indépendants des autres onglets)
  restoreTabFilters(tab);

  // Restaurer/masquer les filtres selon l'onglet
  if (typeof manageFiltersForTab === 'function') manageFiltersForTab(tab);

  // Recalculer les données filtrées à partir des filtres propres à cet onglet
  applyStoredFiltersForTab();
  
  // Titre
  document.title = `Achats - ${getTabTitle(tab)}`;
  
  // Rendre le contenu
  renderTab(tab);
  
  // Appliquer l'état de la barre de filtre
  applyFilterBarState();
  
  // Filtrer le tableau PV si nécessaire
  if (tab === 'pv' && typeof filterPVTable === 'function') {
    filterPVTable();
  }

  // Rafraîchissement forcé en arrière-plan, garanti même si un autre était en cours
  requestAnimationFrame(() => forceTabRefresh(tab));
}
window.restoreActiveTab = restoreActiveTab;

// Nouvelle fonction renderTab avec cache
function renderTab(tab) {
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  const role = String(currentUser?.role || '').toLowerCase();
  const normalizedRole = role === 'back office' || role === 'back_office' || role === 'backoffice' ? 'back_office' : role;
  const canAccessPv = ['admin', 'validateur'].includes(normalizedRole);
  const canAccessAdmin = normalizedRole === 'admin';
  
  // Vérifier si les données sont en cache et récentes (moins de 30s)
  const now = Date.now();
  const isCached = TAB_CACHE.rendered[tab] && (now - TAB_CACHE.lastUpdate[tab] < 30000);
  
  // Si c'est le premier chargement ou si le cache est trop vieux, recharger
  if (!isCached) {
    // Effacer le cache pour cet onglet
    delete TAB_CACHE.data[tab];
  }
  
  switch(tab) {
    case 'dashboard':
    case 'retards':
      renderDashboard();
      break;
    case 'dossiers':
      renderDossiers();
      break;
    case 'qualite':
      if (typeof window.renderQualityPage === 'function') window.renderQualityPage();
      break;
    case 'financier':
      renderFinancier();
      break;
    case 'pv':
      if (!canAccessPv) {
        showToast('Accès refusé : réservé aux validateurs et administrateurs', true);
        switchTab('dashboard');
        return;
      }
      renderPVTable();
      break;
    case 'admin':
      if (!canAccessAdmin) {
        showToast('Accès refusé : réservé aux administrateurs', true);
        switchTab('dashboard');
        return;
      }
      loadUsersAdmin();
      if (typeof toggleAdminCreateSection === 'function') {
        toggleAdminCreateSection(currentUser);
      }
      break;
    default:
      console.warn('Onglet inconnu:', tab);
  }
  
  // Mise à jour du cache
  TAB_CACHE.rendered[tab] = true;
  TAB_CACHE.lastUpdate[tab] = now;
}

// Fonction render principale (inchangée mais utilisée par switchTab)
function render() {
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab) return;
  const tab = activeTab.id.replace('tab-', '');
  renderTab(tab);
}

// ----- Modal Detail (entièrement sécurisée) -----
function openModal(idx) {
  const r = ALL_DATA[idx];
  if (!r) return;
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.textContent = r['designation_demandee'] || r['designation_commandee'] || 'Dossier';
  const subEl = document.getElementById('modalSub');
  if (subEl) subEl.innerHTML = `<span class="modal-meta-item"><strong>📌 N° DA</strong> ${r['numero_da']||'—'}</span><span class="modal-meta-item"><strong>🏢 Filiale</strong> ${r['filiale']||'—'}</span><span class="modal-meta-item"><strong>👤 Acheteur</strong> ${r['acheteur']||'—'}</span><span class="modal-circuit-badge">${isCircuitB(r) ? '🔵 Circuit B · Paiement anticipé' : '🟢 Circuit A · Sans paiement anticipé'}</span>`;
  let steps;
  if (isCircuitB(r)) {
    steps = [
      {name:'Réception', date: r['date_reception_physique'], done: !!r['date_reception_physique']},
      {name:'Consultation', date: r['date_envoi_consultation'], done: !!r['date_envoi_consultation']},
      {name:'TCO', date: r['date_envoi_tco'], done: !!r['date_envoi_tco']},
      {name:'Valid. Filiale', date: r['date_valid_filiale'], done: !!r['date_valid_filiale']},
      {name:'Valid. Comité', date: r['date_valid_comite'], done: !!r['date_valid_comite']},
      {name:'Signature BC', date: r['date_envoi_bc'], done: !!r['date_envoi_bc']},
      {name:'CDG', date: r['date_envoi_cdg'], done: !!r['date_envoi_cdg']},
      {name:'Paiement', date: r['date_paiement'], done: !!r['date_paiement']},
      {name:'Livraison', date: r['date_prevue_livraison'], done: !!r['date_prevue_livraison']}
    ];
  } else {
    steps = [
      {name:'Réception', date: r['date_reception_physique'], done: !!r['date_reception_physique']},
      {name:'Consultation', date: r['date_envoi_consultation'], done: !!r['date_envoi_consultation']},
      {name:'TCO', date: r['date_envoi_tco'], done: !!r['date_envoi_tco']},
      {name:'Valid. Filiale', date: r['date_valid_filiale'], done: !!r['date_valid_filiale']},
      {name:'Valid. Comité', date: r['date_valid_comite'], done: !!r['date_valid_comite']},
      {name:'Signature BC', date: r['date_envoi_bc'], done: !!r['date_envoi_bc']},
      {name:'Livraison', date: r['date_prevue_livraison'], done: !!r['date_prevue_livraison']}
    ];
  }
  const lastDone = steps.reduce((a,s,i)=>s.done?i:a,-1);
  const timeline = `<div class="timeline">` + steps.map((s,i) => {
    const cls = s.done ? 'done' : (i === lastDone+1 ? 'current' : '');
    const line = i<steps.length-1 ? `<div class="timeline-line ${s.done?'done':''}"></div>` : '';
    const icon = s.done ? '✓' : (cls === 'current' ? '!' : String(i + 1));
    const lastStepClass = i === steps.length - 1 ? ' last-step' : '';
    return `<div class="timeline-step ${cls}${lastStepClass}"><div class="timeline-label">${s.name}</div><div class="timeline-dot ${cls}">${icon}</div><div class="timeline-date">${fmtDate(s.date||'')}</div></div>${line}`;
  }).join('') + `</div>`;
  const retardHtml = r._retards.length > 0 ? `<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:12px;margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:8px">⚠ Retards détectés</div>${r._retards.map(rt=>`<div style="font-size:12px;color:var(--text2);margin:4px 0">• ${rt.type} : ${Math.round(rt.heures)}h (${Math.round(rt.heures/24)} jours)</div>`).join('')}</div>` : '';
  const anomaliesHtml = r._anomalies.length > 0 ? `<div style="background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.3);border-radius:8px;padding:12px;margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:var(--orange);margin-bottom:8px">🔍 Anomalies de Processus</div>${r._anomalies.map(a=>`<div style="font-size:12px;color:var(--text2);margin:6px 0;display:flex;gap:8px;align-items:center"><span class="badge badge-${a.criticite.toLowerCase().replace(' ', '-')}">${a.criticite}</span><span>${a.type}</span></div>`).join('')}</div>` : '';
  const fields = [
    ['Filiale', r['filiale']], ['Département', r['departement_demandeur']],
    ['Désig. Commandée', r['designation_commandee']||r['designation_demandee']],
    ['Catégorie', r['categorie_achat']], ['Fournisseur Retenu', r['fournisseur_retenu']],
    ['Statut', r['statut']],
    ['Priorité', r['priorite']], ['Criticité', r._criticite],
    ['Qté', r['quantite'] ? fmtNum(+r['quantite']) + ' ' + (r['unite']||'') : '—'],
    ['Prix Unitaire', r['prix_unitaire'] ? fmtNum(+r['prix_unitaire']) + ' ' + (r['devise']||'') : '—'],
    ['Montant HT', r['montant_ht'] ? fmtNum(+r['montant_ht']) + ' ' + (r['devise']||'MGA') : '—'],
    ['GAIN Achat', r['gain_achat'] ? fmtNum(+r['gain_achat']) + ' ' + (r['devise']||'MGA') : '—'],
    ['Type Paiement', r['type_paiement']], ['Délai Paiement', r['delai_paiement']],
    ['N° BC', r['num_bc']], ['PV N°', r['pv_numero']], ['Code Budget', r['code_budget']],
    ['OBS', r['obs']], ['Action Requise', r['action_requise']]
  ];
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = retardHtml + anomaliesHtml + timeline +
      `<div class="modal-grid">` +
      fields.map(([l,v]) => v ? `<div class="modal-field"><div class="modal-field-label">${l}</div><div class="modal-field-value">${v}</div></div>` : '').join('') +
      `</div>`;
  }
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.classList.add('open');
}
function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModalBtn();
}
function closeModalBtn() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModalBtn(); });
document.addEventListener('DOMContentLoaded', () => {
  if (typeof applyFilterBarState === 'function') applyFilterBarState();
  updateActiveFilterStyles();
});
// Comportement : clic simple sur un onglet = cacher la barre de filtres; double-clic = afficher
document.addEventListener('DOMContentLoaded', () => {
  if (typeof applyFilterBarState === 'function') applyFilterBarState();
  // Clic simple sur une nav-tab -> cacher la barre
  document.addEventListener('click', function _collapseFilterBarOnClick(e) {
    if (!e.target.closest('.nav-tab')) return;
    const tab = e.target.closest('.nav-tab').getAttribute('onclick')?.match(/switchTab\('(.*?)'\)/)?.[1];
    if (isPersistentFilterBarTab(tab)) return;
    filterBarCollapsed = true;
    applyFilterBarState();
  });
  // Double-clic sur une nav-tab -> afficher la barre (réutilise la fonction existante si présente)
  if (typeof expandFilterBarOnDblClick === 'function') {
    document.addEventListener('dblclick', expandFilterBarOnDblClick);
  } else {
    document.addEventListener('dblclick', function _expandFilterBarOnDblClick(e) {
      if (!e.target.closest('.nav-tab')) return;
      filterBarCollapsed = false;
      applyFilterBarState();
    });
  }
});

// ----- Charts helper -----
const chartInstances = {};

let backgroundRefreshTimer = null;
let backgroundRefreshIntervalMs = null;
const DEFAULT_BACKGROUND_REFRESH_INTERVAL_MS = 5000;
const ACHAT_BACKGROUND_REFRESH_INTERVAL_MS = 30000;

function getBackgroundRefreshIntervalMs() {
  return getActiveTab() === 'dossiers'
    ? ACHAT_BACKGROUND_REFRESH_INTERVAL_MS
    : DEFAULT_BACKGROUND_REFRESH_INTERVAL_MS;
}

function clearBackgroundRefreshTimer() {
  if (backgroundRefreshTimer) {
    clearInterval(backgroundRefreshTimer);
    backgroundRefreshTimer = null;
    backgroundRefreshIntervalMs = null;
  }
}

// Rafraîchissement ponctuel et silencieux
function triggerSilentRefresh(options = {}) {
  const { force = false, allowDossiers = false } = options;

  if (document.visibilityState === 'hidden') {
    if (typeof window.stopSilentBackgroundRefresh === 'function') {
      window.stopSilentBackgroundRefresh();
    }
    return Promise.resolve();
  }

  // La grille Achats reste stable pendant la saisie et la consultation.
  // Une actualisation explicite peut toutefois être demandée par le bouton dédié.
  if (getActiveTab() === 'dossiers' && !allowDossiers) {
    clearBackgroundRefreshTimer();
    return Promise.resolve();
  }

  // Toujours maintenir le statut des utilisateurs connectés à jour en arrière-plan.
  if (typeof window.fetchOnlineUsers === 'function') {
    window.fetchOnlineUsers().catch(() => {});
  }
  
  // Ne pas rafraîchir si une pagination est en cours (JAMAIS, même si force = true)
  if (window.__paging_in_progress) return Promise.resolve();
  
  // Éviter les rechargements multiples
  if (IS_REFRESHING) return Promise.resolve();
  
  const hasPendingLocalChanges = (typeof window.achatsHasPendingLocalChanges === 'function' && window.achatsHasPendingLocalChanges()) ||
    (typeof window.pvHasPendingLocalChanges === 'function' && window.pvHasPendingLocalChanges());
  // Ne jamais recharger les données si l'utilisateur a des modifications non
  // sauvegardées dans la grille. Cela évite d'écraser la saisie en cours
  // pendant le polling automatique, sans modifier le comportement des autres
  // écrans et fonctionnalites.
  if (hasPendingLocalChanges) return Promise.resolve();

  const token = localStorage.getItem('authToken');
  if (!token) {
    clearBackgroundRefreshTimer();
    return Promise.resolve();
  }

  if (typeof loadDataFromAPI === 'function') {
    const refreshedTab = getActiveTab();
    IS_REFRESHING = true;
    return loadDataFromAPI({ silent: true, force: true })
      .finally(() => {
        IS_REFRESHING = false;
        if (typeof window.fetchOnlineUsers === 'function') {
          window.fetchOnlineUsers().catch(() => {});
        }
        if (refreshedTab !== 'dossiers') {
          if (typeof applyStoredFiltersForTab === 'function') {
            applyStoredFiltersForTab();
          }
          if (typeof window.render === 'function') {
            window.render();
          }
              if (getActiveTab() === 'pv') setPVLoadingIndicator(false);
        }
      });
  }

  if (typeof window.fetchOnlineUsers === 'function') {
    window.fetchOnlineUsers().catch(() => {});
  }
  return Promise.resolve();
}

// Démarre le polling en arrière-plan, intervalle variable selon l'onglet actif
function startSilentBackgroundRefresh() {
  if (getActiveTab() === 'dossiers') {
    const token = localStorage.getItem('authToken');
    if (!token || document.visibilityState === 'hidden') {
      clearBackgroundRefreshTimer();
      return;
    }

    const intervalMs = ACHAT_BACKGROUND_REFRESH_INTERVAL_MS;
    if (backgroundRefreshTimer && backgroundRefreshIntervalMs === intervalMs) return;

    clearBackgroundRefreshTimer();
    if (typeof window.refreshAchatSheetConfig === 'function') {
      window.refreshAchatSheetConfig().catch(err => console.warn('Actualisation des paramètres des feuilles impossible :', err));
    }
    if (typeof window.syncChangedAchatRows === 'function') {
      window.syncChangedAchatRows();
    }
    backgroundRefreshIntervalMs = intervalMs;
    backgroundRefreshTimer = setInterval(() => {
      if (typeof window.refreshAchatSheetConfig === 'function') {
        window.refreshAchatSheetConfig().catch(err => console.warn('Actualisation des paramètres des feuilles impossible :', err));
      }
      if (typeof window.syncChangedAchatRows === 'function') {
        window.syncChangedAchatRows();
      }
    }, intervalMs);
    return;
  }

  if (document.visibilityState === 'hidden') {
    clearBackgroundRefreshTimer();
    return;
  }
  const token = localStorage.getItem('authToken');
  if (!token) {
    clearBackgroundRefreshTimer();
    return;
  }

  const intervalMs = getBackgroundRefreshIntervalMs();
  if (backgroundRefreshTimer && backgroundRefreshIntervalMs === intervalMs) return;

  clearBackgroundRefreshTimer();
  triggerSilentRefresh();
  backgroundRefreshIntervalMs = intervalMs;
  backgroundRefreshTimer = setInterval(() => {
    triggerSilentRefresh({ force: true });
  }, intervalMs);
}

window.startSilentBackgroundRefresh = startSilentBackgroundRefresh;
window.stopSilentBackgroundRefresh = clearBackgroundRefreshTimer;
window.triggerSilentRefresh = triggerSilentRefresh;

function restartSilentRefreshWhenActive() {
  if (document.visibilityState === 'visible' && localStorage.getItem('authToken')) {
    startSilentBackgroundRefresh();
  }
}

document.addEventListener('visibilitychange', restartSilentRefreshWhenActive);
window.addEventListener('focus', restartSilentRefreshWhenActive);
window.addEventListener('pageshow', restartSilentRefreshWhenActive);

window.clearAppDataCache = function() {
  ALL_DATA = [];
  FILTERED = [];
  currentPage = 1;
  sortKey = null;
  sortAsc = true;
  TAB_CACHE.data = {};
  TAB_CACHE.rendered = {};
  const filterCountEl = document.getElementById('filterCount');
  if (filterCountEl) filterCountEl.textContent = '';
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = '⏳ Chargement...';
};

// Rafraîchissement manuel complet
window.refreshAppInBackground = async function() {
  try {
    if (typeof window.stopSilentBackgroundRefresh === 'function') {
      window.stopSilentBackgroundRefresh();
    }
    if (typeof window.clearAppDataCache === 'function') {
      window.clearAppDataCache();
    }
    await triggerSilentRefresh({ force: true, allowDossiers: true });
    if (typeof window.render === 'function') {
      window.render();
    }
    if (typeof window.loadUsersAdmin === 'function') {
      window.loadUsersAdmin();
    }
    if (typeof window.loadActivityByUser === 'function') {
      window.loadActivityByUser();
    }
    // Rétablir l'onglet actif
    const currentTab = localStorage.getItem('achatsActiveTab') || 'dashboard';
    if (typeof window.switchTab === 'function') {
      window.switchTab(currentTab);
    }
    if (document.body) {
      document.body.classList.remove('app-refreshing');
      void document.body.offsetHeight;
      document.body.classList.add('app-refreshing');
      setTimeout(() => document.body.classList.remove('app-refreshing'), 50);
    }
    if (typeof window.startSilentBackgroundRefresh === 'function') {
      window.startSilentBackgroundRefresh();
    }
  } catch (err) {
    console.warn('Actualisation en arrière-plan impossible', err);
  }
};

function drawChart(id, type, data, options={}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (chartInstances[id]) chartInstances[id].destroy();
  const defaults = {
    responsive: true, maintainAspectRatio: true,
    plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } } },
    scales: type !== 'pie' && type !== 'doughnut' ? {
      x: { ticks: { color: '#94a3b8' }, grid: { display: type === 'bar' ? false : true, color: 'rgba(46,51,80,.5)' } },
      y: { ticks: { color: '#94a3b8' }, grid: { display: type === 'bar' ? false : true, color: 'rgba(46,51,80,.5)' } }
    } : undefined
  };
  chartInstances[id] = new Chart(ctx, { type, data, options: mergeDeep(defaults, options) });
}
function mergeDeep(target, source) {
  const out = Object.assign({}, target);
  for (const key of Object.keys(source||{})) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = mergeDeep(target[key]||{}, source[key]);
    } else { out[key] = source[key]; }
  }
  return out;
}

// ----- Chargement des données depuis l'API -----
async function loadDataFromAPI(options = {}) {
  const { silent = false, force = false } = options;
  try {
    const activeTab = getActiveTab();
    const pvLoadingIndicator = document.getElementById('pvLoadingIndicator');
    if (activeTab === 'pv' && pvLoadingIndicator) {
      pvLoadingIndicator.classList.add('visible');
    }
    const needsAllRows = ['dossiers', 'dashboard', 'pv', 'retards', 'financier'].includes(activeTab);
    window.__FULL_DOSSIERS_LOADED = activeTab === 'dossiers' && needsAllRows;

    const hasPendingLocalChanges = typeof window.achatsHasPendingLocalChanges === 'function' && window.achatsHasPendingLocalChanges();
    // Les modifications locales non sauvegardées doivent toujours primer sur
    // l'actualisation automatique. On ne recharge pas la table tant que
    // l'utilisateur n'a pas validé ou annulé son travail en cours.
    if (hasPendingLocalChanges) {
      return ALL_DATA;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
      ALL_DATA = [];
      FILTERED = [];
      const filterCountEl = document.getElementById('filterCount');
      if (filterCountEl) filterCountEl.textContent = '';
      if (typeof window.clearAuthSession === 'function') {
        window.clearAuthSession();
      }
      return [];
    }

    const meResp = await fetch(apiUrl('/api/auth/me'), { headers: { Authorization: `Bearer ${token}` } });
    if (!meResp.ok) {
      if (typeof window.clearAuthSession === 'function') {
        window.clearAuthSession();
      }
      ALL_DATA = [];
      FILTERED = [];
      const filterCountEl = document.getElementById('filterCount');
      if (filterCountEl) filterCountEl.textContent = '';
      return [];
    }
    const meData = await meResp.json().catch(() => ({}));
    if (meData?.user) {
      if (typeof window.persistAuthSession === 'function') {
        window.persistAuthSession(token, meData.user);
      }
    }

    const headers = { Authorization: `Bearer ${token}` };
    // Si on est en mode paginé, préserver l'offset actuel au lieu de revenir à la première page
    const currentOffset = (!needsAllRows && window.__pagedState?.currentOffset !== undefined && window.__USE_PAGED_MODE)
      ? window.__pagedState.currentOffset
      : 0;
    const query = needsAllRows ? '?limit=all' : `?limit=${PAGE_SIZE}&offset=${currentOffset}`;
    const resp = await fetch(apiUrl(`/api/achats${query}`), { headers, cache: 'no-store' });
    window.__achatLastSyncAt = resp.headers.get('date') || new Date().toISOString();
    if (resp.headers && resp.headers.get) {
      const totalCount = parseInt(resp.headers.get('X-Total-Count') || '0', 10);
      if (window && typeof window === 'object') {
        window.__pagedState = {
          totalCount: Number.isFinite(totalCount) ? totalCount : 0,
          currentOffset: currentOffset,
          nextOffset: currentOffset + PAGE_SIZE,
          pageSize: PAGE_SIZE
        };
      }
    }
    if (resp.status === 401) {
      if (typeof window.clearAuthSession === 'function') {
        window.clearAuthSession();
      }
      if (typeof logout === 'function') logout();
      throw new Error('Session expirée. Veuillez vous reconnecter.');
    }
    if (!resp.ok) throw new Error('Erreur chargement depuis l\'API');
    const data = await resp.json();
    if (silent && activeTab === 'dossiers') {
      const hasPendingAchatChanges = typeof window.achatsHasPendingLocalChanges === 'function' &&
        window.achatsHasPendingLocalChanges();
      const activeEditor = window.hot && typeof window.hot.getActiveEditor === 'function'
        ? window.hot.getActiveEditor()
        : null;
      if (hasPendingAchatChanges || activeEditor?.isOpened) {
        return ALL_DATA;
      }
    }
    const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
    const role = String(currentUser?.role || '').toLowerCase();
    const normalizedRole = role === 'back office' || role === 'back_office' || role === 'backoffice' ? 'back_office' : role;
    const scopedData = (normalizedRole === 'achat' || normalizedRole === 'utilisateur')
      ? data.filter(row => String(row?.acheteur || '').trim() === String(currentUser?.name || currentUser?.identifier || '').trim())
      : data;
    ALL_DATA = enrichData(scopedData);
    FILTERED = [...ALL_DATA];
    window.ALL_DATA = ALL_DATA;
    window.FILTERED = FILTERED;

    // Sécurisation des accès DOM
    const activeTabForFilters = getActiveTab();
    const storedFilterState = loadFilterState(activeTabForFilters);
    const storedFilters = Array.isArray(storedFilterState) ? storedFilterState : (storedFilterState.filters || []);
    const storedSearch = typeof storedFilterState.search === 'string' ? storedFilterState.search : '';
    const currentSearchValue = document.getElementById('pvFilterInput')?.value || '';
    const currentFilterState = getFilterState();
    populateFilters();
    if (silent) {
      restoreFilterState(currentFilterState);
      restoreSearchState(currentSearchValue);
    }
    if (!silent) {
      if (currentFilterState.some(f => hasFilterValue(f.value))) {
        restoreFilterState(currentFilterState);
      } else if (storedFilters.some(f => hasFilterValue(f.value))) {
        restoreFilterState(storedFilters);
      } else {
        restoreFilterState(getFilterState());
      }
      if (currentSearchValue.trim()) {
        restoreSearchState(currentSearchValue);
      } else {
        restoreSearchState(storedSearch);
      }
    }

    const activeFilterState = getFilterState();
    const hasSearchValue = Boolean((document.getElementById('pvFilterInput')?.value || '').trim());
    if (activeFilterState.some(f => hasFilterValue(f.value)) || hasSearchValue) {
      FILTERED = ALL_DATA.filter(r => doesRowMatchAchatFilters(r, activeFilterState));
      if (!silent) {
        applyFilters();
      }
    } else {
      FILTERED = [...ALL_DATA];
      if (!silent) {
        render();
      }
    }

    if (!silent) {
      const dossiersTab = document.getElementById('tab-dossiers');
      if (dossiersTab && dossiersTab.classList.contains('active') && typeof initDossiersTable === 'function') {
        initDossiersTable(FILTERED);
      }
    }
    return ALL_DATA;
  } catch (err) {
    console.error('Erreur chargement données:', err);
    if (!silent) {
      showToast('❌ Erreur chargement des données : ' + err.message, true);
    }
    return [];
  } finally {
    const pvLoadingIndicator = document.getElementById('pvLoadingIndicator');
    if (pvLoadingIndicator) {
      pvLoadingIndicator.classList.remove('visible');
    }
  }
}

// Exposer les fonctions globalement
window.switchTab = switchTab;
window.renderTab = renderTab;
window.restoreActiveTab = restoreActiveTab;
window.render = render;
window.loadDataFromAPI = loadDataFromAPI;
window.ALL_DATA = ALL_DATA;
window.FILTERED = FILTERED;