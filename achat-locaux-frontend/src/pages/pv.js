// ============================================================
// PV COMITÉ
// ============================================================

function getEligibleForPV() {
  return ALL_DATA.filter(r => {
    const budgetStatus = r['statut_budget'];
    const validComiteDate = r['date_valid_comite'];
    const codeBudget = String(r['code_budget'] || '').trim();
    const isStockCode = codeBudget !== '' && ['stock', 'stocks'].includes(codeBudget.toLowerCase());
    // Eligible if statut_budget renseigné et date_valid_comite vide,
    // OR si code_budget indique 'stock'/'stocks' (case-insensitive) and date_valid_comite vide
    return (!validComiteDate || validComiteDate.trim() === '') && ((budgetStatus && budgetStatus.trim() !== '') || isStockCode);
  });
}
function groupPVDossiers(rows) {
  const grouped = {};
  rows.forEach(r => {
    // Group by numero_da, fournisseur_retenu, statut_budget, type_paiement and pv_numero
    // (PV number is part of the grouping key so dossiers with different PV numbers are separated)
    const pvKey = String(r['pv_numero'] || '').trim();
    const key = `${r['numero_da']||''}|${r['fournisseur_retenu']||''}|${r['statut_budget']||''}|${r['type_paiement']||''}|${pvKey}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });
  return Object.values(grouped);
}
function aggregateFieldsPV(rowsGroup) {
  const r = rowsGroup[0];
  const concat = {};
  concat['designation_commandee'] = rowsGroup.map(row => row['designation_commandee']).filter(v => v).join(' + ');
  const firstValue = (field) => {
    for (const row of rowsGroup) {
      const v = row[field];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  };
  const parseNumSafe = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const s = String(v).toString().replace(/\s/g, '').replace(/,/g, '.');
    const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
    return Number.isNaN(n) ? null : n;
  };
  const maxNumeric = (field) => {
    let max = null;
    for (const row of rowsGroup) {
      const n = parseNumSafe(row[field]);
      if (n === null) continue;
      if (max === null || n > max) max = n;
    }
    return max === null ? firstValue(field) : max;
  };
  // Aggregations: sums and weighted sums
  let sum_montant_ht = 0, sum_quantite = 0, sum_gain_achat = 0, sum_ecart_budget = 0;
  let sum_pu_qty = 0, sum_prixref_qty = 0;
  let sum_qty_for_weights = 0;
  let sum_montant_ht_for_ecart = 0;
  let ecart_pct_weighted_numer = 0;
  rowsGroup.forEach(row => {
    const q = parseNumSafe(row['quantite']);
    const mht = parseNumSafe(row['montant_ht']);
    const pu = parseNumSafe(row['prix_unitaire']);
    const pr = parseNumSafe(row['prix_reference']);
    const ga = parseNumSafe(row['gain_achat']);
    const eb = parseNumSafe(row['ecart_budget']);
    const ep = parseNumSafe(row['ecart_pourcentage']);
    if (q !== null) { sum_quantite += q; }
    if (mht !== null) { sum_montant_ht += mht; }
    if (ga !== null) { sum_gain_achat += ga; }
    if (eb !== null) { sum_ecart_budget += eb; }
    if (pu !== null && q !== null) { sum_pu_qty += pu * q; sum_qty_for_weights += q; }
    if (pr !== null && q !== null) { sum_prixref_qty += pr * q; }
    if (mht !== null && ep !== null) { ecart_pct_weighted_numer += ep * mht; sum_montant_ht_for_ecart += mht; }
  });
  const dateFields = ['date_reception_physique', 'date_envoi_consultation', 'date_envoi_tco', 'date_valid_filiale', 'date_envoi_bc', 'date_envoi_cdg', 'date_paiement', 'date_prevue_livraison'];
  const dates = {};
  dateFields.forEach(f => { const vals = rowsGroup.map(row => row[f]).filter(v => v); dates[f] = vals.length > 0 ? vals[0] : ''; });
  const otherTextFields = ['filiale', 'departement_demandeur', 'code_budget', 'statut_budget', 'mode_consultation', 'fournisseurs_consultes', 'devise', 'type_paiement', 'delai_paiement', 'statut_paiement', 'num_bc', 'periode_bc', 'nb_bc', 'statut', 'categorie_achat', 'acheteur', 'obs', 'unite', 'decision'];
  const otherText = {};
  otherTextFields.forEach(f => { const vals = rowsGroup.map(row => row[f]).filter(v => v); otherText[f] = vals.length > 0 ? vals[0] : ''; });
  const pvValues = rowsGroup.map(row => String(row['pv_numero'] || '').trim()).filter(v => v);
  // Prefer the most recently present non-empty pv_numero in the group (reflects recent edits)
  const pvNumeroValue = pvValues.length > 0 ? pvValues[pvValues.length - 1] : '';
  const ecartMoyenne = sum_montant_ht_for_ecart > 0
    ? (ecart_pct_weighted_numer / sum_montant_ht_for_ecart)
    : null;

  // Normalize aggregated numeric outputs so the renderer formats them
  const montant_budget_val = parseNumSafe(maxNumeric('montant_budget'));
  const prix_reference_val = (sum_qty_for_weights > 0) ? (sum_prixref_qty / sum_qty_for_weights) : parseNumSafe(firstValue('prix_reference'));
  const prix_unitaire_val = (sum_qty_for_weights > 0) ? (sum_pu_qty / sum_qty_for_weights) : parseNumSafe(firstValue('prix_unitaire'));
  const ecart_pourcentage_val = ecartMoyenne !== null
    ? ecartMoyenne
    : (prix_unitaire_val !== null && prix_unitaire_val !== 0
      ? ((prix_reference_val === null ? 0 : prix_reference_val) - prix_unitaire_val) / prix_unitaire_val
      : null);
  const quantite_val = sum_quantite || 0;
  const montant_ht_val = sum_montant_ht || 0;
  const gain_achat_val = sum_gain_achat || 0;
  const ecart_budget_val = sum_ecart_budget || 0;
  return {
    'numero_da': r['numero_da'],
    'date_reception_physique': dates['date_reception_physique'],
    'filiale': otherText['filiale'],
    'departement_demandeur': otherText['departement_demandeur'],
    'designation_commandee': concat['designation_commandee'],
    'code_budget': otherText['code_budget'],
    // For grouped rows: use the MAX montant_budget (fallback to first non-empty), to avoid underreporting when items differ
    'montant_budget': montant_budget_val,
    'ecart_budget': ecart_budget_val,
    'statut_budget': otherText['statut_budget'],
    'mode_consultation': otherText['mode_consultation'],
    'fournisseur_retenu': r['fournisseur_retenu'],
    'fournisseurs_consultes': otherText['fournisseurs_consultes'],
    'prix_reference': prix_reference_val,
    'prix_unitaire': prix_unitaire_val,
    'ecart_pourcentage': ecart_pourcentage_val,
    'quantite': quantite_val,
    'unite': otherText['unite'],
    'montant_ht': montant_ht_val,
    'gain_achat': gain_achat_val,
    'devise': otherText['devise'],
    'type_paiement': otherText['type_paiement'],
    'delai_paiement': otherText['delai_paiement'],
    'statut_paiement': otherText['statut_paiement'],
    'date_envoi_consultation': dates['date_envoi_consultation'],
    'date_envoi_tco': dates['date_envoi_tco'],
    'date_valid_filiale': dates['date_valid_filiale'],
    'date_valid_comite': '',
    'pv_numero': pvNumeroValue,
    'num_bc': otherText['num_bc'],
    'date_envoi_bc': dates['date_envoi_bc'],
    'periode_bc': otherText['periode_bc'],
    'nb_bc': otherText['nb_bc'],
    'date_envoi_cdg': dates['date_envoi_cdg'],
    'date_paiement': dates['date_paiement'],
    'date_prevue_livraison': dates['date_prevue_livraison'],
    'statut': otherText['statut'],
    'categorie_achat': otherText['categorie_achat'],
    'acheteur': otherText['acheteur'],
    'obs': otherText['obs']
  };
}
function normalizePVText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function getPVRowIdentity(row) {
  return [row['numero_da'] || '', row['fournisseur_retenu'] || '', row['statut_budget'] || '', row['designation_commandee'] || ''].join('::');
}

function getPVDecisionStateMap() {
  if (!window.PV_DECISION_STATE) {
    try {
      const raw = localStorage.getItem('pvDecisionState');
      window.PV_DECISION_STATE = raw ? JSON.parse(raw) : {};
    } catch (err) {
      window.PV_DECISION_STATE = {};
    }
  }
  return window.PV_DECISION_STATE;
}

function savePVDecisionStateMap() {
  try {
    localStorage.setItem('pvDecisionState', JSON.stringify(getPVDecisionStateMap()));
  } catch (err) {
    console.warn('Impossible de sauvegarder l’état des cases Décision', err);
  }
}

function getPVStateMap() {
  if (!window.PV_PERSIST_STATE) {
    try {
      const raw = localStorage.getItem('pvPersistState');
      window.PV_PERSIST_STATE = raw ? JSON.parse(raw) : {};
    } catch (err) {
      window.PV_PERSIST_STATE = {};
    }
  }
  return window.PV_PERSIST_STATE;
}

function savePVStateMap() {
  try {
    localStorage.setItem('pvPersistState', JSON.stringify(getPVStateMap()));
  } catch (err) {
    console.warn('Impossible de sauvegarder l’état PV', err);
  }
}

function getPVPersistedValue(row, key) {
  const stateMap = getPVStateMap();
  const id = getPVRowIdentity(row);
  if (stateMap[id] && Object.prototype.hasOwnProperty.call(stateMap[id], key)) {
    return stateMap[id][key];
  }
  return undefined;
}

function setPVPersistedValue(row, key, value) {
  const stateMap = getPVStateMap();
  const id = getPVRowIdentity(row);
  if (!stateMap[id]) stateMap[id] = {};
  stateMap[id][key] = value;
  savePVStateMap();
}

function getPVDecisionValue(row) {
  const stateMap = getPVDecisionStateMap();
  const key = getPVRowIdentity(row);
  if (Object.prototype.hasOwnProperty.call(stateMap, key)) {
    return stateMap[key];
  }
  const isBudgetConforme = normalizePVText(row['statut_budget']) === '✅ budget conforme' || normalizePVText(row['statut_budget']) === 'budget conforme';
  return isBudgetConforme;
}

function setPVDecisionValue(row, value) {
  const stateMap = getPVDecisionStateMap();
  stateMap[getPVRowIdentity(row)] = value;
  row['decision'] = value;
  savePVDecisionStateMap();
}

function getPVFilteredRows(rows) {
  const filterInput = document.getElementById('pvFilterInput');
  const searchTerm = normalizePVText(filterInput ? filterInput.value : '');
  if (!searchTerm) return rows;

  return rows.filter(row => normalizePVText(row['pv_numero'] ?? '') === searchTerm);
}

function findPVRowById(id) {
  if (!window.PV_DATA || !window.PV_DATA.rows) return null;
  return window.PV_DATA.rows.find(row => encodeURIComponent(getPVRowIdentity(row)) === id) || null;
}

function renderPVTableRows() {
  if (!window.PV_DATA || !window.PV_DATA.rows) return;
  const { headers, keyMap } = window.PV_DATA;
  const visibleRows = getPVFilteredRows(window.PV_DATA.rows);
  document.getElementById('pvCount').textContent = `${visibleRows.length}/${window.PV_DATA.rows.length} dossiers`;
  document.getElementById('pvTableBody').innerHTML = visibleRows.map((row) => {
    const rowId = encodeURIComponent(getPVRowIdentity(row));
    return `
    <tr>
      ${headers.map(h => {
        const key = keyMap[h];
        const val = row[key];
        let formatted = '';
        if (val !== undefined && val !== null && val !== '') {
          if (key === 'pv_numero') {
            formatted = String(val);
          } else if (typeof val === 'number') {
            formatted = fmtNum(val);
          } else {
            const date = parseDate(val);
            formatted = date ? fmtDate(date) : String(val);
          }
        }
        if (key === 'ecart_pourcentage' && formatted !== '') formatted = `${fmtNum(val * 100)}%`;

        if (h === 'Décision') {
          const isChecked = getPVDecisionValue(row);
          return `<td class="pv-decision-cell" data-row-id="${rowId}" data-key="${key}">
            <label class="pv-decision-label">
              <input type="checkbox" class="pv-decision-checkbox" data-row-id="${rowId}" data-key="${key}" ${isChecked ? 'checked' : ''}>
            </label>
          </td>`;
        }

        let cellClass = 'pv-editable';
        if (h === 'OBS') {
          const persistedObs = getPVPersistedValue(row, 'obs');
          if (persistedObs !== undefined) {
            row['obs'] = persistedObs;
          }
        }
        if (h === 'Statut Budget') {
          if (String(val).includes('Budget Conforme')) cellClass += ' status-dans-budget';
          else if (String(val).includes('Dépassement')) cellClass += ' status-depassement';
          else if (String(val).includes('Hors Budget')) cellClass += ' status-hors-budget';
        }
        return `<td class="${cellClass}" contenteditable="true" data-row-id="${rowId}" data-key="${key}">${String(formatted || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>`;
      }).join('')}
    </tr>
  `;
  }).join('') || '<tr><td colspan="22" class="no-data">Aucun dossier éligible pour le PV</td></tr>';
  setupPVTableEditing();
  requestAnimationFrame(syncPVStickyColumnOffsets);
}

function filterPVTable() {
  const activeTab = document.querySelector('.tab-content.active')?.id?.replace('tab-', '');
  if (activeTab !== 'pv') {
    if (typeof applyFilters === 'function') {
      applyFilters();
    }
    return;
  }
  renderPVTableRows();
}

function syncPVStickyColumnOffsets() {
  const table = document.getElementById('tablePV');
  if (!table) return;
  const firstHeader = table.querySelector('th:nth-child(1)');
  if (!firstHeader) return;
  const firstWidth = firstHeader.getBoundingClientRect().width;
  table.style.setProperty('--pv-col2-left', `${Math.max(firstWidth, 0)}px`);
}

function renderPVTable() {
  const eligible = getEligibleForPV();
  const grouped = groupPVDossiers(eligible);
  const pvData = grouped.map(g => aggregateFieldsPV(g));
  // Sort PV table rows alphabetically by `filiale`
  pvData.sort((a,b) => {
    const fa = normalizePVText(a.filiale);
    const fb = normalizePVText(b.filiale);
    if (fa < fb) return -1;
    if (fa > fb) return 1;
    return 0;
  });
  const refDate = dateToString(new Date());
  const comiteDateObj = nextComiteDate(refDate);
  const comiteDate = comiteDateObj ? `${String(comiteDateObj.getDate()).padStart(2,'0')}/${String(comiteDateObj.getMonth()+1).padStart(2,'0')}/${comiteDateObj.getFullYear()}` : '—';
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;
  const comiteDateDisplay = comiteDate === todayStr ? 'Aujourd\'hui' : comiteDate;
  document.getElementById('pvComiteDate').textContent = comiteDateDisplay;
  const pvNumbers = [...new Set(eligible.map(r => { const pv = String(r['pv_numero'] || '').trim(); return pv.split(/[/-]/)[0]; }).filter(n => n))].sort((a,b) => parseInt(a)-parseInt(b)).join('-');
  const genMonth = String(today.getMonth() + 1).padStart(2, '0');
  const genYear = String(today.getFullYear()).slice(-2);
  const comiteParts = comiteDate.split('/');
  const comiteDay = comiteParts[0], comiteMonth = comiteParts[1], comiteYear = comiteParts[2];
  const pvTitle = pvNumbers ? `PV COMITE ACHATS N°PV-CA-${pvNumbers}/${genMonth}/${genYear} du ${comiteDay}/${comiteMonth}/${comiteYear}` : `PV COMITE ACHATS du ${comiteDay}/${comiteMonth}/${comiteYear}`;
  const headers = ['N° DA', 'Date de reception physique', 'Filiale', 'Dpt. Demandeur', 'Désignation Commandée', 'Code Budget', 'Montant Budget', 'Statut Budget', 'Mode de Consultation', 'Fournisseur Retenu', 'Prix de Référence', 'Prix Unitaire', 'Écart (%)', 'Qté', 'Unité', 'Montant HT', 'Devise', 'Type de Paiement', 'Délai Paiement', 'Décision', 'OBS', 'N°PV'];
  const keyMap = {
    'N° DA': 'numero_da',
    'Date de reception physique': 'date_reception_physique',
    'Filiale': 'filiale',
    'Dpt. Demandeur': 'departement_demandeur',
    'Désignation Commandée': 'designation_commandee',
    'Code Budget': 'code_budget',
    'Montant Budget': 'montant_budget',
    'Statut Budget': 'statut_budget',
    'Mode de Consultation': 'mode_consultation',
    'Fournisseur Retenu': 'fournisseur_retenu',
    'Prix de Référence': 'prix_reference',
    'Prix Unitaire': 'prix_unitaire',
    'Écart (%)': 'ecart_pourcentage',
    'Qté': 'quantite',
    'Unité': 'unite',
    'Montant HT': 'montant_ht',
    'Devise': 'devise',
    'Type de Paiement': 'type_paiement',
    'Délai Paiement': 'delai_paiement',
    'Décision': 'decision',
    'OBS': 'obs',
    'N°PV': 'pv_numero'
  };
  document.getElementById('pvTableHead').innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
  window.PV_DATA = { title: pvTitle, date: comiteDate, rows: pvData, headers, keyMap, totalRows: pvData.length };
  renderPVTableRows();
  requestAnimationFrame(syncPVStickyColumnOffsets);
}

function pvHasPendingLocalChanges() {
  return Boolean(window.PV_EDITING_ACTIVE);
}

function handlePVCellFocus(event) {
  const td = event.target.closest('td.pv-editable');
  if (!td) return;
  window.PV_EDITING_ACTIVE = true;
}

function handlePVCellFocusOut(event) {
  const td = event.target.closest('td.pv-editable');
  if (!td) return;
  handlePVCellBlur({ currentTarget: td });
  window.PV_EDITING_ACTIVE = false;
}

function setupPVTableEditing() {
  const table = document.getElementById('tablePV');
  if (!table) return;
  table.removeEventListener('focusin', handlePVCellFocus);
  table.removeEventListener('focusout', handlePVCellFocusOut);
  table.addEventListener('focusin', handlePVCellFocus);
  table.addEventListener('focusout', handlePVCellFocusOut);
  table.querySelectorAll('input.pv-decision-checkbox').forEach(input => {
    input.removeEventListener('change', handlePVDecisionChange);
    input.addEventListener('change', handlePVDecisionChange);
  });
}

function handlePVCellBlur(event) {
  const td = event.currentTarget;
  const rowId = td.getAttribute('data-row-id');
  const key = td.getAttribute('data-key');
  if (!rowId || !key) return;
  const currentRow = findPVRowById(rowId);
  if (!currentRow) return;
  const text = td.textContent.trim();

  let parsed = text;
  if (key === 'montant_budget' || key === 'prix_reference' || key === 'prix_unitaire' || key === 'quantite' || key === 'montant_ht' || key === 'gain_achat' || key === 'ecart_pourcentage') {
    parsed = parseFloat(text.toString().replace(/,/g, '.').replace(/[^0-9.\-]/g, ''));
    if (isNaN(parsed)) parsed = 0;
  }
  currentRow[key] = parsed;

  if (key === 'obs') {
    setPVPersistedValue(currentRow, 'obs', parsed);
  }

  if (key === 'ecart_pourcentage') {
    parsed = parsed / 100;
    currentRow[key] = parsed;
    td.textContent = `${fmtNum(parsed * 100)}%`;
  }
}

function handlePVDecisionChange(event) {
  const input = event.currentTarget;
  const rowId = input.getAttribute('data-row-id');
  if (!rowId) return;
  const currentRow = findPVRowById(rowId);
  if (!currentRow) return;
  setPVDecisionValue(currentRow, input.checked);
}

function generatePVComite() {
  if (!window.PV_DATA || window.PV_DATA.rows.length === 0) { alert('Aucun dossier éligible'); return; }
  const { title, date, headers, keyMap } = window.PV_DATA;
  const rowsToExport = getPVFilteredRows(window.PV_DATA.rows);
  const dataArray = [[title], [], headers, ...rowsToExport.map(r => headers.map(h => {
    const key = keyMap[h];
    const val = key ? r[key] : '';
    if (h === 'Écart (%)' && val !== undefined && val !== null && val !== '') return fmtNum(val * 100) + '%';
    if (h === 'Décision') {
      const isChecked = getPVDecisionValue(r);
      return isChecked ? '☑' : '☐';
    }
    // Only format specific columns as dates or numbers
    if (h === 'Date de reception physique') {
      const maybeDate = parseDate(val);
      return maybeDate ? fmtDate(maybeDate) : '';
    }
    if (h === 'Prix Unitaire' || h === 'Qté' || h === 'Montant HT') {
      const num = (typeof val === 'number') ? val : parseFloat(String(val).toString().replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
      return isNaN(num) ? '' : fmtNum(num);
    }
    return (val !== undefined && val !== null) ? (typeof val === 'number' ? fmtNum(val) : val) : '';
  }))];
  const ws = XLSX.utils.aoa_to_sheet(dataArray);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'PV Comité');
  XLSX.writeFile(wb, `PV_Comite_${date.replace(/\//g, '-')}.xlsx`);
}

function generatePVSynthese() {
  if (!window.PV_DATA || window.PV_DATA.rows.length === 0) { alert('Aucun dossier éligible'); return; }
  
  const { date, rows } = window.PV_DATA;
  const rowsToExport = getPVFilteredRows(rows);
  
  // Extract unique délai_paiement values from the filtered rows
  const delaiSet = new Set();
  const montantsByDelai = {};
  
  rowsToExport.forEach(r => {
    const delai = r['delai_paiement'] || 'Non spécifié';
    delaiSet.add(delai);
    if (!montantsByDelai[delai]) {
      montantsByDelai[delai] = 0;
    }
    montantsByDelai[delai] += parseFloat(r['montant_ht']) || 0;
  });
  
  // Sort délai values for consistent ordering
  const delaiArray = Array.from(delaiSet).sort();
  
  // Get PV numbers from the title
  const pvNumber = window.PV_DATA.title ? window.PV_DATA.title.split('N°PV-CA-')[1]?.split('/')[0] || 'N/A' : 'N/A';
  
  // Build the synthesis table title
  const synthesisTitle = `TOTAL DES ENGAGEMENTS SUIVANT LES MODALITES DE PAIEMENT - PV - N°${pvNumber}`;
  document.getElementById('syntheseTitle').textContent = synthesisTitle;
  
  // Store synthesis data for export
  window.SYNTHESE_DATA = {
    title: synthesisTitle,
    date: date,
    delaiArray: delaiArray,
    montantsByDelai: montantsByDelai
  };
  
  // Create table header
  const headerRow = document.getElementById('syntheseHead');
  headerRow.innerHTML = `<tr>
    <th></th>
    ${delaiArray.map(delai => `<th>${delai}</th>`).join('')}
    <th>Total</th>
  </tr>`;
  
  // Calculate total for each column
  const totalByDelai = {};
  let grandTotal = 0;
  delaiArray.forEach(delai => {
    totalByDelai[delai] = montantsByDelai[delai] || 0;
    grandTotal += totalByDelai[delai];
  });
  
  // Create table body
  const bodyRow = document.getElementById('syntheseBody');
  bodyRow.innerHTML = `<tr>
    <td>MONTANT TOTAL ARIARY</td>
    ${delaiArray.map(delai => `<td>${fmtNum(totalByDelai[delai])}</td>`).join('')}
    <td><strong>${fmtNum(grandTotal)}</strong></td>
  </tr>`;
  
  // Show the synthesis container
  document.getElementById('syntheseContainer').style.display = 'block';
  document.getElementById('exportSyntheseBtn').style.display = 'inline-block';
  
  // Scroll to the synthesis table
  setTimeout(() => {
    document.getElementById('syntheseContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function exportPVSynthese() {
  if (!window.SYNTHESE_DATA) { alert('Veuillez d\'abord générer la synthèse'); return; }
  
  const { title, date, delaiArray, montantsByDelai } = window.SYNTHESE_DATA;
  
  // Calculate totals
  const totalByDelai = {};
  let grandTotal = 0;
  delaiArray.forEach(delai => {
    totalByDelai[delai] = montantsByDelai[delai] || 0;
    grandTotal += totalByDelai[delai];
  });
  
  // Create Excel data array
  const dataArray = [
    [title],
    [],
    ['', ...delaiArray, 'Total'],  // Header row with délai values and Total
    ['MONTANT TOTAL ARIARY', ...delaiArray.map(delai => totalByDelai[delai]), grandTotal]
  ];
  
  const ws = XLSX.utils.aoa_to_sheet(dataArray);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Synthèse');
  XLSX.writeFile(wb, `Synthese_PV_${date.replace(/\//g, '-')}.xlsx`);
}