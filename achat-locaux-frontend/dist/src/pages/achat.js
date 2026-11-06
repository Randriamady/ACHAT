// ============================================================
// DOSSIERS – Handsontable (en‑têtes avec couleurs harmonisées)
// ============================================================

(function() {
  function mountAchatTemplate() {
    const container = document.getElementById('tab-dossiers');
    if (!container || container.dataset.templateLoaded === 'true') return;

    fetch('/pageachat.html', { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error('Page achat introuvable');
        return response.text();
      })
      .then(html => {
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const bodyHtml = bodyMatch ? bodyMatch[1] : html;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = bodyHtml;

        container.innerHTML = bodyHtml;
        container.dataset.templateLoaded = 'true';

        const scriptNodes = [...wrapper.querySelectorAll('script')];
        scriptNodes.forEach(node => {
          const script = document.createElement('script');
          const code = node.textContent || node.innerHTML || '';
          script.textContent = `(function() {\n${code}\n})();`;
          document.body.appendChild(script);
          script.remove();
        });

        const styleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
        styleMatches.forEach(match => {
          const style = document.createElement('style');
          style.textContent = match[1] || '';
          document.head.appendChild(style);
        });
      })
      .catch(error => {
        console.error('Erreur chargement template achat:', error);
        container.innerHTML = '<div style="padding:24px;color:#d93025;">Le template de la page achat est indisponible.</div>';
      });
  }

  const hotContainer = document.getElementById('hot');
  const statusEl = document.getElementById('status');
  let statusTimeout = null;
  let useServerPagination = false;
  let pendingHotRenderFrame = null;
  let pendingRowStateRows = [];
  let pendingRowStateFrame = null;

  function scheduleHotRender() {
    if (!hot || typeof hot.render !== 'function') return;
    if (pendingHotRenderFrame) return;
    pendingHotRenderFrame = window.requestAnimationFrame(() => {
      pendingHotRenderFrame = null;
      if (hot && typeof hot.render === 'function') hot.render();
    });
  }

  function scheduleRowReadOnlyStateUpdate(rows) {
    if (!hot) return;
    const rowsArray = Array.isArray(rows) ? rows : [rows];
    rowsArray.forEach((rowIndex) => {
      if (Number.isInteger(rowIndex) && rowIndex >= 0) pendingRowStateRows.push(rowIndex);
    });
    if (pendingRowStateFrame) return;
    pendingRowStateFrame = window.requestAnimationFrame(() => {
      pendingRowStateFrame = null;
      const uniqueRows = Array.from(new Set(pendingRowStateRows));
      pendingRowStateRows = [];
      if (uniqueRows.length) updateRowReadOnlyState(uniqueRows);
    });
  }

  function getDisplayRowsForCurrentPage(sourceData) {
    const rows = Array.isArray(sourceData) ? sourceData : [];
    return rows.filter(row => !isRowEmpty(row)).concat(rows.filter(row => isRowEmpty(row)));
  }

  function getVisibleRowRange() {
    if (!hot) return null;
    try {
      const visible = hot.getVisibleRows ? hot.getVisibleRows() : null;
      if (Array.isArray(visible) && visible.length) {
        const start = Math.max(0, visible[0] - 10);
        const end = Math.min(Math.max(0, (hot.countRows ? hot.countRows() : 0) - 1), visible[visible.length - 1] + 10);
        return { start, end };
      }
    } catch (e) {
      // ignore and fallback below
    }
    const totalRows = hot.countRows ? hot.countRows() : 0;
    if (!totalRows) return null;
    const firstVisible = typeof hot.getFirstVisibleRow === 'function' ? hot.getFirstVisibleRow() : 0;
    const lastVisible = typeof hot.getLastVisibleRow === 'function' ? hot.getLastVisibleRow() : totalRows - 1;
    return {
      start: Math.max(0, firstVisible - 10),
      end: Math.min(Math.max(0, totalRows - 1), lastVisible + 10)
    };
  }

  function showStatusMessage(message, delay = 2000) {
    if (!statusEl) return;
    statusEl.innerText = message;
    if (statusTimeout) clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => {
      statusEl.innerText = '';
      statusTimeout = null;
    }, delay);
  }

  function updateStatusBar(message) {
    if (!statusEl) return;
    statusEl.innerText = message;
  }

  function cloneAchatData(data) {
    return typeof structuredClone === 'function'
      ? structuredClone(data)
      : JSON.parse(JSON.stringify(data));
  }

  function getAchatDuplicateKey(row) {
    if (!row || typeof row !== 'object' || isRowEmpty(row)) return null;
    if (row.id !== undefined && row.id !== null && row.id !== '') return `id:${String(row.id)}`;
    if (row.numero_da !== undefined && row.numero_da !== null && String(row.numero_da).trim() !== '') {
      return `da:${String(row.numero_da).trim().toLowerCase()}`;
    }
    return null;
  }

  function replaceAchatCacheRow(collection, savedRow) {
    if (!Array.isArray(collection) || !savedRow || typeof savedRow !== 'object') return;
    const savedId = savedRow.id === undefined || savedRow.id === null ? null : String(savedRow.id);
    const savedDa = savedRow.numero_da === undefined || savedRow.numero_da === null
      ? ''
      : String(savedRow.numero_da).trim().toLowerCase();
    const index = collection.findIndex(row => {
      if (!row || typeof row !== 'object') return false;
      const rowId = row.id === undefined || row.id === null ? null : String(row.id);
      const rowDa = row.numero_da === undefined || row.numero_da === null
        ? ''
        : String(row.numero_da).trim().toLowerCase();
      return savedId !== null ? rowId === savedId : (savedDa !== '' && rowDa === savedDa);
    });
    if (index >= 0) collection[index] = savedRow;
    else collection.push(savedRow);
  }

  function deduplicateAchatRows(rows) {
    if (!Array.isArray(rows)) return [];
    const rowsByKey = new Map();
    const rowsWithoutId = [];
    rows.forEach(row => {
      if (!row || typeof row !== 'object') return;
      const key = getAchatDuplicateKey(row);
      if (!key) {
        rowsWithoutId.push(row);
        return;
      }
      rowsByKey.set(key, row);
    });
    return [...rowsByKey.values(), ...rowsWithoutId];
  }

  // Renderers
  const CURRENT_ROLE_RAW = JSON.parse(localStorage.getItem('user') || 'null')?.role || '';
  const CURRENT_ROLE = String(CURRENT_ROLE_RAW || '').toLowerCase().trim();
  const NORMALIZED_ROLE = CURRENT_ROLE === 'back office' || CURRENT_ROLE === 'back_office' || CURRENT_ROLE === 'backoffice'
    ? 'back_office'
    : CURRENT_ROLE === 'cdg' || CURRENT_ROLE === 'cgd' || CURRENT_ROLE === 'cdg ' || CURRENT_ROLE === ' cdg'
      ? 'cdg'
      : CURRENT_ROLE;
  const minSpareAchatRows = NORMALIZED_ROLE === 'utilisateur' ? 0 : 1;

  function getCurrentAchatOwner() {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null');
      return String(user?.name || user?.identifier || user?.username || '').trim();
    } catch (e) {
      return '';
    }
  }

  const ALLOWED_EDITABLE_FIELDS = ['code_budget', 'montant_budget'];
  const BACK_OFFICE_EDITABLE_FIELDS = ['num_bc', 'date_envoi_bc', 'periode_bc', 'nb_bc', 'date_envoi_cdg', 
                                        'date_paiement', 'date_prevue_livraison', 'date_reception_facture', 'numero_facture',
                                        'bl', 'be', 'date_transmission', 'statut', 'categorie_achat',
                                        'obs', 'cas_exceptionnel', 'action_requise', 'priorite', 'budget_valide'];
  const AUTO_LOCKED_FIELDS = new Set(['montant_ht', 'gain_achat', 'ecart_budget', 'statut_budget', 'ecart_pourcentage', 'budget_valide']);
  const CALC_HIGHLIGHT_FIELDS = new Set(['montant_ht', 'gain_achat', 'ecart_budget', 'ecart_pourcentage', 'statut_budget']);
  const CONDITIONAL_FIELDS = new Set(['cas_exceptionnel']);

  // ------------------------------------------------------------
  // NOUVELLES FONCTIONS POUR LES RÈGLES
  // ------------------------------------------------------------
  function isMontantBudgetFilled(row) {
    if (!row || typeof row !== 'object') return false;
    const val = row['montant_budget'];
    return val !== undefined && val !== null && val !== '' && String(val).trim() !== '';
  }

  function shouldSuppressBudgetColorForCdg(rowData) {
    return NORMALIZED_ROLE === 'cdg' && !isMontantBudgetFilled(rowData);
  }

  function getColorlessClassName(baseClassName, suppressColor) {
    if (!suppressColor) return baseClassName;
    const colorClasses = new Set(['htDimmed', 'htAutoLocked', 'htCalcField', 'htConditional', 'htBudgetLocked', 'htBudgetRowLocked', 'htCdgEditable']);
    return baseClassName
      .split(' ')
      .filter(Boolean)
      .filter(className => !colorClasses.has(className))
      .join(' ')
      .trim();
  }

  function applyCdgNoBudgetColoring() {
    if (!hot || NORMALIZED_ROLE !== 'cdg') return;

    const columnsDef = (hot.getSettings().columns || []);
    const range = getRenderedRange();
    const rowStart = Math.max(0, range.rowStart);
    const rowEnd = Math.max(rowStart, range.rowEnd);
    const colStart = Math.max(0, range.colStart);
    const colEnd = Math.max(colStart, range.colEnd);
    let changed = false;

    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex++) {
      const rowData = hot.getSourceDataAtRow(rowIndex) || {};
      const suppressColor = shouldSuppressBudgetColorForCdg(rowData);

      for (let colIndex = colStart; colIndex <= colEnd; colIndex++) {
        const colDef = columnsDef[colIndex] || {};
        const baseClassName = String(colDef.className || '');
        const className = getColorlessClassName(baseClassName, suppressColor)
          .split(' ')
          .filter(className => className !== 'htBudgetRowLocked' && className !== 'htBudgetLocked')
          .join(' ')
          .trim();
        const nextClassName = suppressColor
          ? `${className} htCdgNoBudgetColor`.trim()
          : className;
        const currentMeta = hot.getCellMeta(rowIndex, colIndex) || {};
        if (currentMeta.className !== nextClassName) changed = true;
        if (suppressColor) {
          hot.setCellMeta(rowIndex, colIndex, 'className', nextClassName);
        } else {
          hot.setCellMeta(rowIndex, colIndex, 'className', nextClassName);
        }

        const td = hot.getCell(rowIndex, colIndex);
        if (td) {
          td.style.backgroundColor = '';
          td.style.color = '';
        }
      }
    }
    if (changed) scheduleHotRender();
  }

  function isCdgOnlyField(colData) {
    return colData === 'montant_budget' || colData === 'code_budget';
  }

  // Détermine si une colonne est éditable pour une ligne donnée,
  // réutilise la même logique que `beforeBeginEditing` pour cohérence.
  function isColumnEditableForRow(rowData, colData) {
    if (!rowData) return true;
    // CDG : seul montant_budget et code_budget sont modifiables
    if (NORMALIZED_ROLE === 'cdg') {
      if (colData === 'montant_budget' && String(rowData.pv_numero || '').trim() === '') return false;
      return isCdgOnlyField(colData) && !AUTO_LOCKED_FIELDS.has(colData);
    }
    // Back Office
    if (NORMALIZED_ROLE === 'back_office') {
      const numBcIndex = columns.findIndex(c => c.data === 'num_bc');
      const colIndex = columns.findIndex(c => c.data === colData);
      if (colData === 'acheteur' || isCdgOnlyField(colData) || AUTO_LOCKED_FIELDS.has(colData)) return false;
      if (numBcIndex >= 0 && colIndex >= 0 && colIndex < numBcIndex) return false;
      return true;
    }

    // Autres rôles
    const montantFilled = isMontantBudgetFilled(rowData);
    if (colData === 'montant_budget') return false;
    if (colData === 'code_budget') return !AUTO_LOCKED_FIELDS.has(colData);
    if (montantFilled) return isColumnEditableWhenFilled(colData) && !AUTO_LOCKED_FIELDS.has(colData) && !isCdgOnlyField(colData);
    return !AUTO_LOCKED_FIELDS.has(colData) && !isCdgOnlyField(colData);
  }

  // Colonnes autorisées quand montant_budget est rempli
  const ALLOWED_COLUMNS_WHEN_FILLED = new Set([
    'date_valid_comite', 'num_bc', 'date_envoi_bc', 'periode_bc', 'nb_bc',
    'date_envoi_cdg', 'date_paiement', 'date_prevue_livraison', 'date_reception_facture',
    'numero_facture', 'bl', 'be', 'date_transmission', 'statut', 'obs'
  ]);

  function isColumnEditableWhenFilled(colData) {
    return ALLOWED_COLUMNS_WHEN_FILLED.has(colData);
  }

  // ------------------------------------------------------------
  // calcul dynamique de la hauteur du tableau selon l'écran
  // ------------------------------------------------------------
  function computeHotHeight() {
    if (!hotContainer) return 420;

    const parent = hotContainer.parentElement || document.body;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const parentRect = parent.getBoundingClientRect();
    const styles = window.getComputedStyle(parent);
    const parentPaddingTop = parseFloat(styles.paddingTop || '0');
    const parentPaddingBottom = parseFloat(styles.paddingBottom || '0');

    let siblingsHeight = 0;
    Array.from(parent.children).forEach((child) => {
      if (child !== hotContainer) {
        siblingsHeight += child.getBoundingClientRect().height;
      }
    });

    const available = viewportHeight - parentRect.top - parentPaddingTop - parentPaddingBottom - siblingsHeight - 12;
    return Math.max(180, Math.min(available, viewportHeight - 90));
  }

  function calculateAchatDerivedFields(row) {
    const toNumber = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const number = typeof value === 'number'
        ? value
        : Number(String(value).trim().replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(number) ? number : null;
    };
    const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
    const budget = toNumber(row.montant_budget);
    const reference = toNumber(row.prix_reference);
    const unitPrice = toNumber(row.prix_unitaire);
    const quantity = toNumber(row.quantite);
    const amountHt = unitPrice !== null && quantity !== null ? roundMoney(unitPrice * quantity) : null;

    return {
      montant_ht: amountHt,
      ecart_budget: budget !== null && amountHt !== null ? roundMoney(budget - amountHt) : null,
      statut_budget: budget === null || amountHt === null
        ? null
        : budget >= amountHt
          ? '✅ Budget Conforme'
          : budget === 0
            ? '⛔ Hors budget'
            : '↗️ Dépassement',
      ecart_pourcentage: reference !== null && reference !== 0 && unitPrice !== null
        ? Math.round(((unitPrice - reference) / reference + Number.EPSILON) * 10000) / 10000
        : null,
      gain_achat: reference !== null && unitPrice !== null && quantity !== null
        ? roundMoney((reference - unitPrice) * quantity)
        : null
    };
  }

  // ------------------------------------------------------------
  // marquage "façon Excel" de la zone copiée
  // ------------------------------------------------------------
  (function injectExcelCopyStyle() {
    if (document.getElementById('excel-copy-marker-style')) return;
    const style = document.createElement('style');
    style.id = 'excel-copy-marker-style';
    style.textContent = `
      @keyframes excelMarchingAnts {
        to { background-position: 8px 0, 8px 8px, 0 8px, 0 0; }
      }
      #excel-copy-overlay {
        position: absolute;
        display: none;
        pointer-events: none;
        z-index: 30;
        background-image:
          linear-gradient(90deg, #217346 50%, transparent 50%),
          linear-gradient(90deg, #217346 50%, transparent 50%),
          linear-gradient(0deg, #217346 50%, transparent 50%),
          linear-gradient(0deg, #217346 50%, transparent 50%);
        background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
        background-size: 8px 2px, 8px 2px, 2px 8px, 2px 8px;
        background-position: 0 0, 0 100%, 0 0, 100% 0;
        animation: excelMarchingAnts 0.5s linear infinite;
      }
      #excel-selection-overlay {
        position: absolute;
        display: none;
        pointer-events: none;
        z-index: 25;
        box-sizing: border-box;
        background: rgba(37, 99, 235, 0.03);
      }
      /* Surbrillance de la ligne active (tous rôles) : appliquée via l'option native
         Handsontable "currentRowClassName" pour éviter de réécrire les styles existants.
         Bleu renforcé, transparent, visible sur toutes les lignes actives. */
      .handsontable td.htActiveRow {
        box-shadow: inset 0 0 0 9999px rgba(37, 99, 235, 0.25);
      }
    `;
    document.head.appendChild(style);
  })();

  // ------------------------------------------------------------
  // Style : cellules verrouillées automatiquement dès que le montant
  // budget est renseigné (règle "montant_budget rempli"). Rouge légèrement
  // transparent, en box-shadow pour rester superposable aux autres couleurs
  // d'état (budget conforme/dépassé, etc.) sans jamais les écraser.
  // ------------------------------------------------------------
  (function injectBudgetLockedStyle() {
    if (document.getElementById('budget-locked-style')) return;
    const style = document.createElement('style');
    style.id = 'budget-locked-style';
    style.textContent = `
      .handsontable td.htBudgetLocked {
        box-shadow: none;
        cursor: default;
      }
      .handsontable td.htBudgetRowLocked {
        background-color: #eef1f4 !important;
        color: #69727d !important;
      }
      .handsontable td.htBudgetRowLocked input,
      .handsontable td.htBudgetRowLocked select,
      .handsontable td.htBudgetRowLocked textarea {
        color: #69727d !important;
      }
    `;
    document.head.appendChild(style);
  })();

  let excelCopyMarkerCoords = null;
  let copyOverlayEl = null;
  let __isScrolling = false;
  let __scrollIdleTimer = null;

  function ensureCopyOverlay() {
    if (copyOverlayEl) return copyOverlayEl;
    if (!hotContainer) return null;
    const computed = window.getComputedStyle(hotContainer);
    if (computed.position === 'static') hotContainer.style.position = 'relative';
    copyOverlayEl = document.createElement('div');
    copyOverlayEl.id = 'excel-copy-overlay';
    hotContainer.appendChild(copyOverlayEl);
    return copyOverlayEl;
  }

  function hideCopyOverlay() {
    if (copyOverlayEl) copyOverlayEl.style.display = 'none';
  }

  function clearExcelCopyMarker() {
    excelCopyMarkerCoords = null;
    hideCopyOverlay();
  }

  function positionCopyOverlay() {
    const overlay = ensureCopyOverlay();
    if (!hot || !overlay || !excelCopyMarkerCoords) { hideCopyOverlay(); return; }
    const { startRow, startCol, endRow, endCol } = excelCopyMarkerCoords;
    const minRow = Math.min(startRow, endRow), maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol), maxCol = Math.max(startCol, endCol);
    const tdStart = hot.getCell(minRow, minCol);
    const tdEnd = hot.getCell(maxRow, maxCol);
    if (!tdStart || !tdEnd) { hideCopyOverlay(); return; }
    const containerRect = hotContainer.getBoundingClientRect();
    const startRect = tdStart.getBoundingClientRect();
    const endRect = tdEnd.getBoundingClientRect();
    const left = startRect.left - containerRect.left;
    const top = startRect.top - containerRect.top;
    const width = endRect.right - startRect.left;
    const height = endRect.bottom - startRect.top;
    if (width <= 0 || height <= 0) { hideCopyOverlay(); return; }
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
    overlay.style.width = width + 'px';
    overlay.style.height = height + 'px';
    overlay.style.display = 'block';
  }

  function applyExcelCopyMarker() {
    positionCopyOverlay();
  }

  let excelSelectionCoords = null;
  let selectionOverlayEl = null;

  function ensureSelectionOverlay() {
    if (selectionOverlayEl) return selectionOverlayEl;
    if (!hotContainer) return null;
    const computed = window.getComputedStyle(hotContainer);
    if (computed.position === 'static') hotContainer.style.position = 'relative';
    selectionOverlayEl = document.createElement('div');
    selectionOverlayEl.id = 'excel-selection-overlay';
    hotContainer.appendChild(selectionOverlayEl);
    return selectionOverlayEl;
  }

  function hideSelectionOverlay() {
    if (selectionOverlayEl) selectionOverlayEl.style.display = 'none';
  }

  function clearExcelSelectionMarker() {
    excelSelectionCoords = null;
    hideSelectionOverlay();
  }

  function positionSelectionOverlay() {
    const overlay = ensureSelectionOverlay();
    if (!hot || !overlay || !excelSelectionCoords) { hideSelectionOverlay(); return; }
    const { startRow, startCol, endRow, endCol } = excelSelectionCoords;
    const minRow = Math.min(startRow, endRow), maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol), maxCol = Math.max(startCol, endCol);
    const tdStart = hot.getCell(minRow, minCol);
    const tdEnd = hot.getCell(maxRow, maxCol);
    if (!tdStart || !tdEnd) { hideSelectionOverlay(); return; }
    const containerRect = hotContainer.getBoundingClientRect();
    const startRect = tdStart.getBoundingClientRect();
    const endRect = tdEnd.getBoundingClientRect();
    const left = startRect.left - containerRect.left;
    const top = startRect.top - containerRect.top;
    const width = endRect.right - startRect.left;
    const height = endRect.bottom - startRect.top;
    if (width <= 0 || height <= 0) { hideSelectionOverlay(); return; }
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
    overlay.style.width = width + 'px';
    overlay.style.height = height + 'px';
    overlay.style.display = 'block';
  }

  function applyExcelSelectionMarker() {
    positionSelectionOverlay();
  }

  function preserveCopiedRowOnPaste(data, coords) {
    if (!hot || !Array.isArray(data) || !data.length || !Array.isArray(coords) || !coords.length) return;
    if (!excelCopyMarkerCoords) return;

    const sourceStartCol = Math.min(excelCopyMarkerCoords.startCol, excelCopyMarkerCoords.endCol);
    const sourceEndCol = Math.max(excelCopyMarkerCoords.startCol, excelCopyMarkerCoords.endCol);
    const isFullRowCopy = sourceStartCol === 0 && sourceEndCol >= columns.length - 1;
    if (!isFullRowCopy) return;

    const targetRow = Math.min(coords[0].startRow, coords[0].endRow);
    const targetData = hot.getSourceDataAtRow(targetRow);
    const sourceRow = Math.min(excelCopyMarkerCoords.startRow, excelCopyMarkerCoords.endRow);
    const sourceData = hot.getSourceDataAtRow(sourceRow);
    if (!isRowEmpty(targetData) || !sourceData || !data[0]) return;

    const pastedNumeroDa = data[0][0];
    const sourceNumeroDa = sourceData.numero_da;
    if (normalizeComparableValue(pastedNumeroDa) === normalizeComparableValue(sourceNumeroDa)) {
      data[0][0] = '';
    }
  }

  function pasteFromClipboardAtSelection() {
    if (!hot) return;
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      alert('Le collage via le menu nécessite un navigateur compatible (Chrome/Edge) et l\'autorisation d\'accès au presse-papiers. Vous pouvez aussi utiliser Ctrl+V.');
      return;
    }
    navigator.clipboard.readText().then(text => {
      if (!text) return;
      const selected = hot.getSelected();
      const startRow = selected && selected.length ? Math.min(selected[0][0], selected[0][2]) : 0;
      const startCol = selected && selected.length ? Math.min(selected[0][1], selected[0][3]) : 0;
      const lines = text.replace(/\r/g, '').split('\n');
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      const dataMatrix = lines.map(line => line.split('\t'));
      hot.populateFromArray(startRow, startCol, dataMatrix, null, null, 'Autofill.fill');
      clearExcelCopyMarker();
    }).catch(err => {
      console.error('Erreur lecture presse-papiers :', err);
      alert('Impossible de lire le presse-papiers. Utilisez Ctrl+V, ou autorisez l\'accès au presse-papiers pour ce site.');
    });
  }

  // ============================================================
  // Pagination / chargement par pages pour virtual scroll
  // ============================================================
  let __paged_totalCount = null;
  let __paged_nextOffset = 0;
  let __paged_isLoading = false;
  let lastAchatSyncAt = window.__achatLastSyncAt || null;
  let syncChangedRequest = null;
  const __PAGE_SIZE = (typeof PAGE_SIZE === 'number' && PAGE_SIZE > 0) ? PAGE_SIZE : 500;
  const __EMPTY_INPUT_ROWS = 5;
  if (!window.__pagedState) {
    window.__pagedState = { totalCount: null, currentOffset: 0, nextOffset: __PAGE_SIZE, pageSize: __PAGE_SIZE };
  } else {
    window.__pagedState.currentOffset = Number.isFinite(window.__pagedState.currentOffset) ? window.__pagedState.currentOffset : 0;
    window.__pagedState.nextOffset = Number.isFinite(window.__pagedState.nextOffset) ? window.__pagedState.nextOffset : __PAGE_SIZE;
    window.__pagedState.pageSize = __PAGE_SIZE;
  }
  // Flag global indiquant qu'on utilise la pagination distante
  window.__USE_PAGED_MODE = window.__USE_PAGED_MODE || false;

  async function fetchPage(offset, limit = __PAGE_SIZE, mode = 'append', options = {}) {
    const { silent = false } = options;
    if (typeof offset !== 'number' || offset < 0) offset = 0;
    const pageLimit = Number.isFinite(limit) && limit > 0 ? limit : __PAGE_SIZE;
    const isNextBatch = offset > 0;
    const visibleRow = silent && hot && typeof hot.getFirstVisibleRow === 'function'
      ? hot.getFirstVisibleRow()
      : null;
    const visibleRowId = visibleRow !== null && hot && typeof hot.getSourceDataAtRow === 'function'
      ? hot.getSourceDataAtRow(visibleRow)?.id
      : null;
    useServerPagination = true;
    __paged_isLoading = true;
    window.__paging_in_progress = true;
    window.__USE_PAGED_MODE = true;  // Marquer immédiatement qu'on utilise la pagination
    if (!silent) {
      setLoadingState(true);
      updateStatusBar(pageLimit
        ? (isNextBatch ? `⏳ Chargement des ${pageLimit} lignes suivantes...` : `⏳ Chargement des ${pageLimit} premières lignes...`)
        : '⏳ Chargement de toutes les lignes...'
      );
    }
    try {
      const token = localStorage.getItem('authToken');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const query = pageLimit ? `?limit=${pageLimit}&offset=${offset}` : `?offset=${offset}`;
      const resp = await fetch(apiUrl(`/api/achats${query}`), { headers, cache: 'no-store' });
      if (resp.status === 401) {
        if (typeof window.stopSilentBackgroundRefresh === 'function') {
          window.stopSilentBackgroundRefresh();
        }
        if (!window.__authLogoutInProgress) {
          window.__authLogoutInProgress = true;
          if (typeof window.logout === 'function') {
            window.logout().finally(() => {
              window.__authLogoutInProgress = false;
            });
          } else if (typeof window.clearAuthSession === 'function') {
            window.clearAuthSession();
            window.__authLogoutInProgress = false;
          }
        }
        throw new Error('Session expirée. Veuillez vous reconnecter.');
      }
      if (!resp.ok) throw new Error('Erreur fetch page: ' + resp.status);
      const rows = await resp.json();
      if (!Array.isArray(rows)) return [];
      if (!lastAchatSyncAt) lastAchatSyncAt = resp.headers.get('date') || new Date().toISOString();
      window.__achatLastSyncAt = lastAchatSyncAt;
      const totalHeader = resp.headers.get('X-Total-Count');
      const totalCount = totalHeader ? parseInt(totalHeader, 10) : null;
      if (totalCount !== null) {
        __paged_totalCount = totalCount;
        window.__pagedState = { ...(window.__pagedState || {}), totalCount, currentOffset: offset, nextOffset: offset + rows.length, pageSize: pageLimit };
      }
      const formatted = rows.map(r => formatRowDatesForDisplay(r));
      const enriched = enrichData(formatted);
      if (mode === 'refresh') {
        const source = hot && Array.isArray(hot.getSourceData()) ? hot.getSourceData() : [];
        const refreshedById = new Map(enriched.filter(row => row?.id !== undefined && row?.id !== null).map(row => [String(row.id), row]));
        const changedIds = new Set();
        const sourceIds = new Set(source.map(row => String(row?.id)).filter(id => id !== 'undefined' && id !== 'null'));
        const addedRows = [];

        source.forEach((row, index) => {
          const refreshed = refreshedById.get(String(row?.id));
          if (!refreshed) return;
          Object.assign(row, refreshed);
          const allIndex = ALL_DATA.findIndex(item => String(item?.id) === String(refreshed.id));
          if (allIndex >= 0) ALL_DATA[allIndex] = refreshed;
          const filteredIndex = FILTERED.findIndex(item => String(item?.id) === String(refreshed.id));
          if (filteredIndex >= 0) FILTERED[filteredIndex] = refreshed;
          changedIds.add(String(refreshed.id));
        });

        refreshedById.forEach((row, id) => {
          if (sourceIds.has(id)) return;
          ALL_DATA.push(row);
          addedRows.push(row);
        });
        ALL_DATA = deduplicateAchatRows(ALL_DATA);

        const activeFilters = typeof getAchatFilterState === 'function' ? getAchatFilterState() : null;
        const hasActiveFilters = activeFilters && Object.values(activeFilters).some(value => value !== '' && value !== undefined && value !== null);
        FILTERED = hasActiveFilters && typeof doesRowMatchAchatFilters === 'function'
          ? ALL_DATA.filter(row => doesRowMatchAchatFilters(row, activeFilters))
          : [...ALL_DATA];

        if (changedIds.size || addedRows.length) {
          const refreshedSource = getDisplayRowsForCurrentPage(deduplicateAchatRows(FILTERED));
          const changedIndexes = refreshedSource.reduce((indexes, row, index) => {
            if (changedIds.has(String(row?.id))) indexes.push(index);
            return indexes;
          }, []);
          _rowReadOnlyCache = {};
          runRowsInChunks(changedIndexes, 100, (slice) => updateRowReadOnlyState(slice));
          savedSnapshot = cloneAchatData(refreshedSource);
          isBackgroundRefresh = true;
          try {
            hot.updateSettings({ data: refreshedSource });
          } finally {
            isBackgroundRefresh = false;
          }
          if (typeof populateFilters === 'function') populateFilters();
          hot.render();
          if (visibleRow !== null && typeof hot.scrollViewportTo === 'function') {
            const restoredRow = visibleRowId !== null && visibleRowId !== undefined
              ? hot.getSourceData().findIndex(row => String(row?.id) === String(visibleRowId))
              : visibleRow;
            hot.scrollViewportTo(restoredRow >= 0 ? restoredRow : visibleRow, 0, true);
          }
        }
        return enriched;
      }
      if (mode === 'replace') {
        ALL_DATA = enriched;
        const hasActiveFilters = typeof getAchatFilterState === 'function' && Object.values(getAchatFilterState()).some(v => v !== '' && v !== undefined && v !== null);
        FILTERED = hasActiveFilters
          ? enriched.filter(r => doesRowMatchAchatFilters(r, getAchatFilterState()))
          : enriched;
        FILTERED = getDisplayRowsForCurrentPage(FILTERED);
        const nextPageOffset = offset + rows.length;
        __paged_nextOffset = nextPageOffset;
        window.__pagedState = { ...(window.__pagedState || {}), totalCount: __paged_totalCount ?? window.__pagedState?.totalCount ?? null, currentOffset: offset, nextOffset: nextPageOffset, pageSize: pageLimit };
        if (hot) {
          const hotFilterState = typeof getHotFilterState === 'function' ? getHotFilterState() : null;
          const previousBudgetById = new Map((hot.getSourceData() || []).map(row => [String(row?.id), row?.montant_budget]));
          savedSnapshot = cloneAchatData(FILTERED);
          isBackgroundRefresh = true;
          try {
            hot.updateSettings({ data: FILTERED });
          } finally {
            isBackgroundRefresh = false;
          }
          if (typeof populateFilters === 'function') populateFilters();
          if (hot && typeof hot.render === 'function') hot.render();
          if (visibleRow !== null && typeof hot.scrollViewportTo === 'function') {
            const restoredRow = visibleRowId !== null && visibleRowId !== undefined
              ? hot.getSourceData().findIndex(row => String(row?.id) === String(visibleRowId))
              : visibleRow;
            hot.scrollViewportTo(restoredRow >= 0 ? restoredRow : visibleRow, 0, true);
          }
          if (hotFilterState && typeof restoreHotFilterState === 'function') restoreHotFilterState(hotFilterState);
          const changedRows = FILTERED.reduce((indexes, row, index) => {
            if (previousBudgetById.get(String(row?.id)) !== row?.montant_budget) indexes.push(index);
            return indexes;
          }, []);
          if (changedRows.length) {
            _rowReadOnlyCache = {};
            runRowsInChunks(changedRows, 100, (slice) => updateRowReadOnlyState(slice));
          }
        }
        return enriched;
      }

      // Append to global caches, avoiding duplicates by id
      const existingIds = new Set(ALL_DATA.filter(x => x && x.id).map(x => String(x.id)));
      const toAppend = [];
      enriched.forEach(e => {
        if (e && e.id && existingIds.has(String(e.id))) return;
        toAppend.push(e);
        if (e && e.id) existingIds.add(String(e.id));
      });
      toAppend.forEach(e => ALL_DATA.push(e));
      ALL_DATA = deduplicateAchatRows(ALL_DATA);
      const activeFilters = typeof getAchatFilterState === 'function' ? getAchatFilterState() : null;
      const hasActiveFiltersAfterAppend = activeFilters && Object.values(activeFilters).some(v => v !== '' && v !== undefined && v !== null);
      if (hasActiveFiltersAfterAppend && typeof doesRowMatchAchatFilters === 'function') {
        FILTERED = ALL_DATA.filter(r => doesRowMatchAchatFilters(r, activeFilters));
      } else if (!hasActiveFiltersAfterAppend) {
        FILTERED = [...ALL_DATA];
      }
      // If table already exists, append the new rows and refresh
      if (hot) {
        const hotFilterState = typeof getHotFilterState === 'function' ? getHotFilterState() : null;
        const scrollHolder = hot.rootElement?.querySelector('.wtHolder');
        const scrollTop = scrollHolder ? scrollHolder.scrollTop : null;
        const scrollLeft = scrollHolder ? scrollHolder.scrollLeft : null;
        const src = hot.getSourceData();
        const previousRowCount = Array.isArray(src) ? src.length : 0;
        if (Array.isArray(src)) {
          const nextRows = getDisplayRowsForCurrentPage(
            (hasActiveFiltersAfterAppend ? FILTERED : [...src, ...toAppend])
              .map(row => formatRowDatesForDisplay(row))
          );
          savedSnapshot = cloneAchatData(nextRows);
          isBackgroundRefresh = true;
          try {
            hot.updateSettings({ data: nextRows });
          } finally {
            isBackgroundRefresh = false;
          }
          _rowReadOnlyCache = {};
          const newRowIndexes = Array.from(
            { length: Math.max(0, nextRows.length - previousRowCount) },
            (_, index) => previousRowCount + index
          );
          runRowsInChunks(newRowIndexes, 100, (slice) => updateRowReadOnlyState(slice));
        }
        if (typeof populateFilters === 'function') populateFilters();
        if (hot && typeof hot.render === 'function') hot.render();
        if (scrollHolder) {
          scrollHolder.scrollTop = scrollTop;
          scrollHolder.scrollLeft = scrollLeft;
        }
        if (hotFilterState && typeof restoreHotFilterState === 'function') {
          restoreHotFilterState(hotFilterState);
        }
      }
      // advance next offset by the number of rows returned by server
      const nextOffset = offset + rows.length;
      __paged_nextOffset = nextOffset;
      window.__pagedState = { ...(window.__pagedState || {}), totalCount: __paged_totalCount ?? window.__pagedState?.totalCount ?? null, currentOffset: offset, nextOffset, pageSize: pageLimit };
      // mark that we are using paged mode when first page loaded
      if (offset === 0 && rows.length > 0) {
        window.__USE_PAGED_MODE = true;
      }
      return toAppend;
    } catch (err) {
      console.error('fetchPage error:', err);
      return [];
    } finally {
      __paged_isLoading = false;
      if (!silent) {
        setLoadingState(false);
        updateStatusBar(isNextBatch
          ? `✅ ${pageLimit} lignes suivantes chargées`
          : `✅ ${pageLimit} lignes affichées`
        );
      }
      // Délai réduit avant de permettre au rafraîchissement en arrière-plan de se relancer
      setTimeout(() => {
        window.__paging_in_progress = false;
        if (pendingSilentSync && !hasLocalChanges && !isSaving && !pendingSave) {
          pendingSilentSync = false;
          syncChangedAchatRows();
        }
      }, 1000);
    }
  }

  async function syncChangedAchatRows() {
    if (syncChangedRequest) return syncChangedRequest;
    if (window.__paging_in_progress || hasLocalChanges || isSaving || pendingSave) {
      pendingSilentSync = true;
      return Promise.resolve([]);
    }
    const activeEditor = hot && typeof hot.getActiveEditor === 'function' ? hot.getActiveEditor() : null;
    if (activeEditor && activeEditor.isOpened) {
      pendingSilentSync = true;
      return Promise.resolve([]);
    }
    const token = localStorage.getItem('authToken');
    if (!token) return Promise.resolve([]);

    syncChangedRequest = (async () => {
      if (typeof window.loadDataFromAPI === 'function') {
        const previousRows = ALL_DATA;
        const visibleRow = hot && typeof hot.getFirstVisibleRow === 'function' ? hot.getFirstVisibleRow() : null;
        const visibleRowId = visibleRow !== null && hot && typeof hot.getSourceDataAtRow === 'function'
          ? hot.getSourceDataAtRow(visibleRow)?.id
          : null;
        const hotFilterState = hot && typeof getHotFilterState === 'function' ? getHotFilterState() : null;
        await window.loadDataFromAPI({ silent: true, force: true });
        const activeEditor = hot && typeof hot.getActiveEditor === 'function' ? hot.getActiveEditor() : null;
        if (hasLocalChanges || isSaving || pendingSave || (activeEditor && activeEditor.isOpened)) {
          pendingSilentSync = true;
          return;
        }
        ALL_DATA = deduplicateAchatRows(ALL_DATA);
        const previousRowsById = new Map(previousRows.map(row => [String(row?.id), JSON.stringify(row)]));
        const hasDataChanged = previousRows.length !== ALL_DATA.length ||
          ALL_DATA.some(row => previousRowsById.get(String(row?.id)) !== JSON.stringify(row));
        const activeFilters = typeof getAchatFilterState === 'function' ? getAchatFilterState() : null;
        const hasActiveFilters = activeFilters && Object.values(activeFilters).some(value => value !== '' && value !== undefined && value !== null);
        FILTERED = hasActiveFilters && typeof doesRowMatchAchatFilters === 'function'
          ? ALL_DATA.filter(row => doesRowMatchAchatFilters(row, activeFilters))
          : [...ALL_DATA];
        window.ALL_DATA = ALL_DATA;
        window.FILTERED = FILTERED;
        if (hot && hasDataChanged) {
          const filteredRows = getDisplayRowsForCurrentPage(
            (Array.isArray(FILTERED) ? FILTERED : []).map(row => formatRowDatesForDisplay(row))
          );
          savedSnapshot = cloneAchatData(filteredRows);
          isBackgroundRefresh = true;
          try {
            if (typeof hot.loadData === 'function') {
              hot.loadData(filteredRows);
            } else {
              hot.updateSettings({
                data: filteredRows,
                minRows: Math.max(1, filteredRows.length)
              });
            }
          } finally {
            isBackgroundRefresh = false;
          }
          _rowReadOnlyCache = {};
          const visibleRange = getVisibleRowRange();
          if (visibleRange) {
            const visibleRows = Array.from(
              { length: visibleRange.end - visibleRange.start + 1 },
              (_, index) => visibleRange.start + index
            );
            updateRowReadOnlyState(visibleRows);
          }
          if (hotFilterState && typeof restoreHotFilterState === 'function') restoreHotFilterState(hotFilterState);
          hot.render();
          if (visibleRow !== null && typeof hot.scrollViewportTo === 'function') {
            const restoredRow = visibleRowId !== null && visibleRowId !== undefined
              ? hot.getSourceData().findIndex(row => String(row?.id) === String(visibleRowId))
              : visibleRow;
            hot.scrollViewportTo(restoredRow >= 0 ? restoredRow : visibleRow, 0, true);
          }
        }
        return;
      }

      const currentOffset = window.__pagedState?.currentOffset ?? 0;
      const pageSize = window.__pagedState?.pageSize ?? __PAGE_SIZE;
      const loadedRows = window.__pagedState?.nextOffset ?? 0;
      const refreshLimit = Math.max(pageSize, loadedRows || pageSize);
      await fetchPage(0, refreshLimit, 'replace', { silent: true });
      window.__pagedState.currentOffset = Math.min(currentOffset, Math.max(0, refreshLimit - pageSize));
    })().finally(() => {
      syncChangedRequest = null;
    });

    return syncChangedRequest;
  }

  function resumePendingRefreshAfterValidation() {
    setTimeout(() => {
      const activeEditor = hot && typeof hot.getActiveEditor === 'function' ? hot.getActiveEditor() : null;
      if (activeEditor && activeEditor.isOpened) return;
      if (hasLocalChanges || isSaving || pendingSave) return;

      if (pendingDataUpdatedEvent) {
        const event = pendingDataUpdatedEvent;
        pendingDataUpdatedEvent = null;
        document.dispatchEvent(event);
      }
      if (pendingSilentSync) {
        pendingSilentSync = false;
        syncChangedAchatRows();
      }
    }, 0);
  }

  function resetPagination() {
    __paged_totalCount = null;
    __paged_nextOffset = 0;
    __paged_isLoading = false;
    window.__pagedState = { totalCount: null, currentOffset: 0, nextOffset: __PAGE_SIZE, pageSize: __PAGE_SIZE };
    useServerPagination = false;
    // Clear caches
    ALL_DATA = [];
    FILTERED = [];
    if (hot && Array.isArray(hot.getSourceData())) {
      hot.updateSettings({ data: [] });
    }
    window.__USE_PAGED_MODE = false;
  }

  function setTableLoadingIndicator(on) {
    if (!hotContainer) return;
    let indicator = hotContainer.querySelector('.achat-table-loading');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'achat-table-loading';
      indicator.setAttribute('role', 'status');
      indicator.setAttribute('aria-live', 'polite');
      indicator.innerHTML = '<span class="achat-table-loading-spinner" aria-hidden="true"></span><span>Chargement...</span>';
      hotContainer.appendChild(indicator);
    }
    indicator.classList.toggle('visible', Boolean(on));
  }

  function setLoadingState(on) {
    try {
      setTableLoadingIndicator(on);
      if (!statusEl) return;
      if (on) {
        statusEl.innerText = `⏳ Chargement des données...`;
      } else {
        statusEl.innerText = '✅ Toutes les lignes affichées';
      }
    } catch (e) { /* ignore */ }
  }

  // Expose helpers for other modules
  window.fetchPage = fetchPage;
  window.syncChangedAchatRows = syncChangedAchatRows;
  window.resetPagination = resetPagination;

  function loadNextPageIfNeeded(lastVisibleRow) {
    if (window.__FULL_DOSSIERS_LOADED) return;
    const rawTotalCount = window.__pagedState?.totalCount ?? __paged_totalCount ?? null;
    const totalCount = Number.isFinite(rawTotalCount) && rawTotalCount > 0 ? rawTotalCount : null;
    const currentLoaded = (hot && Array.isArray(hot.getSourceData())) ? hot.getSourceData().length : ALL_DATA.length;

    if (__paged_isLoading) return;
    if (totalCount !== null && currentLoaded >= totalCount) return;

    const buffer = 50;
    const targetRow = Number.isFinite(lastVisibleRow) ? lastVisibleRow : currentLoaded - 1;

    if (targetRow >= currentLoaded - buffer) {
      const nextOffset = Math.max(
        __paged_nextOffset,
        window.__pagedState?.nextOffset ?? 0
      );
      if (nextOffset < totalCount || totalCount === null) {
        fetchPage(nextOffset);
      }
    }
  }

  // ============================================================
  // RENDERERS DE BASE - DOIVENT ÊTRE DÉFINIS EN PREMIER
  // ============================================================
  
  function numericRenderer(instance, td, row, col, prop, value, cellProperties) {
    Handsontable.renderers.BaseRenderer.apply(this, arguments);
    if (value !== null && value !== undefined && !isNaN(parseFloat(value))) {
      const num = parseFloat(value);
      td.textContent = formatDisplayNumber(num, 2);
    } else td.textContent = '';
  }
  
  function percentRenderer(instance, td, row, col, prop, value, cellProperties) {
    Handsontable.renderers.BaseRenderer.apply(this, arguments);
    if (value !== null && value !== undefined && !isNaN(parseFloat(value))) {
      const num = parseFloat(value) * 100;
      td.textContent = `${formatDisplayNumber(num, 2)} %`;
    } else td.textContent = '';
  }

  function identificationRenderer(instance, td, row, col, prop, value, cellProperties) {
    const rowData = instance.getSourceDataAtRow(row) || {};
    const idValue = rowData.id ?? value;
    td.textContent = (idValue !== null && idValue !== undefined && idValue !== '') ? String(idValue) : '';
    td.style.fontWeight = '600';
    td.style.textAlign = 'center';
  }

  // ============================================================
  // RENDERERS PERSONNALISÉS - APRÈS LES RENDERERS DE BASE
  // ============================================================
  
  // Renderer pour code_budget - CDG : pas de coloration, curseur main, et info-bulle adaptée
  function codeBudgetRenderer(instance, td, row, col, prop, value, cellProperties) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    
    const isCdg = NORMALIZED_ROLE === 'cdg';
    const rowData = instance.getSourceDataAtRow(row) || {};
    const suppressBudgetColor = shouldSuppressBudgetColorForCdg(rowData);
    
    // CDG : si le montant budget est vide, aucune coloration n'est appliquée.
    if (isCdg || suppressBudgetColor) {
      td.style.backgroundColor = '';
      td.style.color = '';
      td.style.cursor = 'pointer';
      td.title = (value === undefined || value === null || value === '' || String(value).trim() === '')
        ? 'Code budget (modifiable par CDG)'
        : 'Code budget (modifiable par CDG)';
      td.textContent = (value !== null && value !== undefined && value !== '') ? String(value) : '';
      return;
    }
    
    // Pour les autres rôles
    const isEmpty = value === undefined || value === null || value === '' || String(value).trim() === '';
    const montantFilled = isMontantBudgetFilled(rowData);
    
    if (isEmpty) {
      if (montantFilled) {
        td.style.backgroundColor = '#fee2e2';
        td.title = '⚠️ Code budget requis car montant budget est renseigné';
        td.style.cursor = 'help';
      } else {
        td.style.backgroundColor = '';
        td.style.color = '';
        td.title = 'Code budget non renseigné';
        td.style.cursor = 'help';
      }
      td.textContent = '';
    } else {
      td.style.backgroundColor = '';
      td.style.color = '';
      td.style.cursor = 'text';
      td.title = 'Code budget';
      td.textContent = String(value);
    }
  }

  function montantBudgetRenderer(instance, td, row, col, prop, value, cellProperties) {
    // Appeler le renderer numérique existant
    numericRenderer(instance, td, row, col, prop, value, cellProperties);
    
    const rowData = instance.getSourceDataAtRow(row) || {};
    const isEmpty = value === undefined || value === null || value === '' || String(value).trim() === '';
    const isCdg = NORMALIZED_ROLE === 'cdg';
    const suppressBudgetColor = shouldSuppressBudgetColorForCdg(rowData);
    
    // CDG : si le montant budget est vide, aucune coloration n'est appliquée.
    if (isCdg || suppressBudgetColor) {
      td.style.backgroundColor = '';
      td.style.color = '';
      td.style.cursor = 'pointer';
      td.title = 'Montant budget (modifiable par CDG)';
      // La valeur est déjà affichée par numericRenderer
      return;
    }
    
    // Comportement pour les autres rôles
    if (isColumnEditableForRow(rowData, 'montant_budget')) {
      td.title = isEmpty ? '⚠️ Veuillez renseigner le montant budget' : 'Montant budget';
      td.style.cursor = 'text';
      td.style.backgroundColor = '';
      return;
    }

    if (isEmpty) {
      td.style.backgroundColor = '';
      td.style.color = '';
      td.title = '⚠️ Cette colonne est réservée au CDG';
      td.style.cursor = 'not-allowed';
    } else {
      td.style.backgroundColor = '#dbeafe';
      td.title = 'Montant budget renseigné';
      td.style.cursor = 'default';
    }
  }

  function dateValidComiteRenderer(instance, td, row, col, prop, value, cellProperties) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    const rowData = instance.getSourceDataAtRow(row);
    if (!rowData) return;

    const isCdg = NORMALIZED_ROLE === 'cdg';
    const suppressBudgetColor = shouldSuppressBudgetColorForCdg(rowData);
    if (isCdg || suppressBudgetColor) {
      td.style.backgroundColor = '';
      td.style.color = '';
      td.style.cursor = 'pointer';
      td.title = 'Date de validation comité';
      return;
    }

    const montantBudgetEmpty = !isMontantBudgetFilled(rowData);

    // Si la colonne est éditable pour cette ligne, ne pas colorer
    if (isColumnEditableForRow(rowData, 'date_valid_comite')) {
      if (value && String(value).trim() !== '') {
        td.style.color = '';
        td.style.backgroundColor = '';
      }
      return;
    }

    if (montantBudgetEmpty) {
      td.style.backgroundColor = '';
      td.style.color = '';
      td.title = '⚠️ La date de validation comité ne peut pas être renseignée si le montant budget est vide.';
      td.style.cursor = 'help';
      return;
    }

    if (value && String(value).trim() !== '') {
      td.style.backgroundColor = '#dcfce7';
      td.style.color = '#166534';
    } else {
      td.style.backgroundColor = '';
      td.style.color = '';
    }
  }

  // ============================================================
  // getEffectiveColumns - CORRIGÉ
  // ============================================================
  function getEffectiveColumns(columnsList) {
    const numBcIndex = columnsList.findIndex(c => c.data === 'num_bc');
    
    return columnsList.map(col => {
      const isAutoLocked = AUTO_LOCKED_FIELDS.has(col.data);
      const isCalcHighlight = CALC_HIGHLIGHT_FIELDS.has(col.data);
      const isConditional = CONDITIONAL_FIELDS.has(col.data);
      const isCdgField = isCdgOnlyField(col.data);
      
      const baseClassName = [
        isCalcHighlight ? null : col.className,
        isCalcHighlight ? 'htCalcField' : (isAutoLocked ? 'htAutoLocked' : ''),
        isConditional ? 'htConditional' : '',
        isCdgField ? 'htCdgOnly' : ''
      ].filter(Boolean).join(' ');

      // CDG : les deux colonnes sont modifiables, pas de coloration spéciale
      if (NORMALIZED_ROLE === 'cdg') {
        return { 
          ...col, 
          readOnly: true, 
          className: baseClassName // Supprimer htCdgEditable
        };
      }
      
      // Back Office
      if (NORMALIZED_ROLE === 'back_office') {
        // Back office ne peut pas modifier code_budget et montant_budget
        if (isCdgField || col.data === 'acheteur' || isAutoLocked || (numBcIndex >= 0 && columnsList.indexOf(col) < numBcIndex)) {
          return { ...col, readOnly: true, className: baseClassName };
        }
        return { ...col, readOnly: true, className: baseClassName };
      }
      
      // Autres rôles (admin, validateur, achat, utilisateur)
      // - montant_budget : readOnly (réservé CDG)
      // - code_budget : modifiable
      if (col.data === 'montant_budget') {
        return { ...col, readOnly: true, className: `${baseClassName} htReservedForCdg` };
      }
      
      // code_budget et autres colonnes : modifiable sauf auto-lockées
      return { ...col, readOnly: true, className: baseClassName };
    });
  }

  // Listes déroulantes
  const LISTE_FILIALE = [
    'Consortium', 'FCS', 'Fondation Akbaraly', 'GIT', 'GS', 'GS Aviation', 'GTE',
    'M4W', 'MTN', 'Mytsore', 'SICD', 'SIDM', 'SOCIR', 'SPAH', 'SWTT', 'Trapmad'
  ];
  const LISTE_DEPARTEMENT = [
    'Accueil et Moyens généraux', 'Bougie', 'Centre Kintana', 'Client Externe', 'Cordes',
    'DAF', 'DCG', 'Dépôt', 'Direction', 'Distribution', 'DOP', 'DOQ', 'DSI', 'Encaustique',
    'ERP', 'Famille', 'Imprimerie', 'Laboratoire', 'Liquide vaisselle', 'Maintenance', 'PMD',
    'Production', 'Savonnerie', 'Sce Achat', 'Sce Assurance', 'Sce Communication',
    'Sce Comptabilité', 'Sce Fiscalité', 'Sce Import-Export', 'Sce Juridique', 'Sce Logistique',
    'Sce Marketing', 'Sce RH', 'Sce Trésorerie', 'Sécurité et Sureté', 'SMD', 'Tadynyl',
    'Tour GS', 'Usine'
  ];
  const LISTE_MODE_CONSULTATION = ['Appel d\'Offres', 'Contrat', 'Demande de devis (spot)', 'Gré à gré'];
  const LISTE_UNITE = ['Barre', 'Bidon', 'Bouteille', 'Feuilles', 'FFT', 'Flacon', 'Fût', 'Kg', 'Km', 'Litre', 'm²', 'm3', 'Mètre', 'Ml', 'Pack', 'Paires', 'Paquet', 'Sac', 'Unité', 'Vide'];
  const LISTE_DEVISE = ['EUR', 'MGA', 'USD'];
  const LISTE_TYPE_PAIEMENT = ['Chèque', 'Espèce', 'Traite', 'Virement'];
  const LISTE_DELAI_PAIEMENT = ['25% commande + 75% livraison', '30 jours', '45 jours', '30% commande + 70% livraison', '50% commande + 50% livraison', '60 jours', '60 jours Fin du mois', '70% commande + 30% livraison', '75% commande + 25% livraison', '90 jours', 'A la commande', 'A la livraison', 'Au comptant'];
  const LISTE_STATUT = ['Annulé', 'Attente choix filiale', 'Attente comité', 'Attente DA', 'Attente livraison', 'Attente précision filiale', 'Attente de paiement', 'BC en cours de signature', 'BC transmis fournisseur', 'Compte bloquée', 'Consultation en cours', 'Livré', 'Stand-by'];
  const LISTE_CATEGORIE_ACHAT = ['Alimentaire', 'Carburant', 'Consommable Imprimerie', 'Consommable Informatique', 'Consommable médical', 'Divers', 'Don', 'Emballage', 'EPI', 'Formation', 'Fourniture administrative', 'Fourniture de bureau', 'Logiciel et licence', 'Machine industrielle', 'Matériaux de construction', 'Matériel électrique', 'Matériel frigorifique', 'Matériel informatique', 'Matériel médical', 'Matériel plomberie', 'Matériel roulant', 'Matières Premières', 'Médicament', 'Outillage', 'Peinture', 'Pièces de rechanges', 'Prestation de Services', 'Produit de ménage', 'Produit hygiénique', 'Publicité', 'Quincaillerie', 'Rebobinage', 'Sanitaire', 'Sidérurgie', 'Travaux'];

  // Définition des colonnes
  const columns = [
    { data: 'numero_da', title: 'N° DA', headerClassName: 'ht-header-identification' },
    { data: 'date', title: 'Date', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-demande' },
    { data: 'date_reception_physique', title: 'Date de reception physique', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-demande' },
    { data: 'filiale', title: 'Filiale', type: 'dropdown', source: LISTE_FILIALE, strict: false, headerClassName: 'ht-header-demande' },
    { data: 'departement_demandeur', title: 'Dpt. Demandeur', type: 'dropdown', source: LISTE_DEPARTEMENT, strict: false, headerClassName: 'ht-header-demande' },
    { data: 'designation_demandee', title: 'Désignation Demandée', width: 350, headerClassName: 'ht-header-article' },
    { data: 'designation_commandee', title: 'Désignation Commandée', width: 400, headerClassName: 'ht-header-article' },
    { data: 'code_budget', title: 'Code Budget', renderer: codeBudgetRenderer, headerClassName: 'ht-header-budget' },
    { data: 'montant_budget', title: 'Montant Budget', type: 'numeric', renderer: montantBudgetRenderer, headerClassName: 'ht-header-budget' },
    { data: 'ecart_budget', title: 'Écart Budget', type: 'numeric', renderer: numericRenderer, readOnly: true, className: 'htDimmed', headerClassName: 'ht-header-budget' },
    { data: 'statut_budget', title: 'Statut Budget', readOnly: true, className: 'htDimmed', headerClassName: 'ht-header-budget' },
    { data: 'mode_consultation', title: 'Mode de Consultation', type: 'dropdown', source: LISTE_MODE_CONSULTATION, strict: false, headerClassName: 'ht-header-fournisseur' },
    { data: 'fournisseur_retenu', title: 'Fournisseur Retenu', headerClassName: 'ht-header-fournisseur' },
    { data: 'fournisseurs_consultes', title: 'Fournisseurs Consultés', width: 150, headerClassName: 'ht-header-fournisseur' },
    { data: 'prix_reference', title: 'Prix de Référence', type: 'numeric', renderer: numericRenderer, headerClassName: 'ht-header-prix-gain' },
    { data: 'prix_unitaire', title: 'Prix Unitaire', type: 'numeric', renderer: numericRenderer, headerClassName: 'ht-header-prix-gain' },
    { data: 'ecart_pourcentage', title: 'Écart (%)', type: 'numeric', renderer: percentRenderer, readOnly: true, className: 'htDimmed', headerClassName: 'ht-header-prix-gain' },
    { data: 'quantite', title: 'Qté', type: 'numeric', renderer: numericRenderer, headerClassName: 'ht-header-prix-gain' },
    { data: 'unite', title: 'Unité', type: 'dropdown', source: LISTE_UNITE, strict: false, headerClassName: 'ht-header-prix-gain' },
    { data: 'montant_ht', title: 'Montant HT', type: 'numeric', renderer: numericRenderer, readOnly: true, className: 'htDimmed', headerClassName: 'ht-header-prix-gain' },
    { data: 'gain_achat', title: 'GAIN Achat', type: 'numeric', renderer: numericRenderer, readOnly: true, className: 'htDimmed', headerClassName: 'ht-header-prix-gain' },
    { data: 'devise', title: 'Devise', type: 'dropdown', source: LISTE_DEVISE, strict: false, headerClassName: 'ht-header-prix-gain' },
    { data: 'type_paiement', title: 'Type de Paiement', type: 'dropdown', source: LISTE_TYPE_PAIEMENT, strict: false, headerClassName: 'ht-header-paiement' },
    { data: 'delai_paiement', title: 'Délai Paiement', type: 'dropdown', source: LISTE_DELAI_PAIEMENT, strict: false, headerClassName: 'ht-header-paiement' },
    { data: 'statut_paiement', title: 'Statut Paiement', headerClassName: 'ht-header-paiement' },
    { data: 'date_envoi_consultation', title: 'Date Envoi Consultation', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-dates-processus' },
    { data: 'date_envoi_tco', title: 'Date Envoi TCO', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-dates-processus' },
    { data: 'date_valid_filiale', title: 'Date Valid. Filiale', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-dates-processus' },
    { data: 'date_valid_comite', title: 'Date Valid. Comité', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, renderer: dateValidComiteRenderer, headerClassName: 'ht-header-dates-processus' },
    { data: 'pv_numero', title: 'PV N°', headerClassName: 'ht-header-dates-processus' },
    { data: 'num_bc', title: 'N° BC', headerClassName: 'ht-header-bon-commande' },
    { data: 'date_envoi_bc', title: 'Date Envoi BC', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-bon-commande' },
    { data: 'immatriculation_vehicule', title: 'Immatriculation du véhicule', headerClassName: 'ht-header-bon-commande' },
    { data: 'utilisateur_vehicule', title: 'Utilisateur du véhicule', headerClassName: 'ht-header-bon-commande' },
    { data: 'date_envoi_cdg', title: 'Date Envoi CDG', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-bon-commande' },
    { data: 'date_paiement', title: 'Date de Paiement', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-suivi-statut' },
    { data: 'date_prevue_livraison', title: 'Date Prévu Livraison', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-suivi-statut' },
    { data: 'date_reception_facture', title: 'Date Reception Facture', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-suivi-statut' },
    { data: 'numero_facture', title: 'N° Facture', headerClassName: 'ht-header-suivi-statut' },
    { data: 'bl', title: 'BL', headerClassName: 'ht-header-suivi-statut' },
    { data: 'be', title: 'BE', headerClassName: 'ht-header-suivi-statut' },
    { data: 'date_transmission', title: 'Date Transmission', type: 'date', dateFormat: 'DD/MM/YYYY', correctFormat: true, headerClassName: 'ht-header-suivi-statut' },
    { data: 'statut', title: 'Statut', type: 'dropdown', source: LISTE_STATUT, strict: false, headerClassName: 'ht-header-suivi-statut' },
    { data: 'categorie_achat', title: 'Catégorie Achat', type: 'dropdown', source: LISTE_CATEGORIE_ACHAT, strict: false, headerClassName: 'ht-header-suivi-statut' },
    { data: 'acheteur', title: 'Acheteur', headerClassName: 'ht-header-suivi-statut' },
    { data: 'obs', title: 'OBS', width: 300, headerClassName: 'ht-header-suivi-statut' },
    { data: 'action_requise', title: 'Action Requise', headerClassName: 'ht-header-suivi-statut' },
    { data: 'priorite', title: 'Priorité', headerClassName: 'ht-header-suivi-statut' },
    { data: 'nb_bc', title: 'NB BC', type: 'numeric', renderer: numericRenderer, headerClassName: 'ht-header-bon-commande' }
  ];

  const effectiveColumns = getEffectiveColumns(columns).map((column) => ({
    ...column,
    width: 200
  }));

  let hot = null;
  let savedSnapshot = [];
  let saveTimeout = null;
  let isSaving = false;
  let pendingSave = false;
  let pendingSilentSync = false;
  let pendingDeleteIds = [];
  let hasLocalChanges = false;
  let isBackgroundRefresh = false;
  let _lastRenderStamp = 0;
  // Conserve le dernier événement dataUpdated ignoré pendant une édition/sauvegarde
  // en cours, pour le rejouer proprement une fois que c'est terminé.
  let pendingDataUpdatedEvent = null;

  // Cache pour optimiser les mises à jour readOnly
  let _rowReadOnlyCache = {};

  // Sauvegarde / restauration de l'état des filtres Handsontable
  function getHotFilterState() {
    if (!hot) return null;
    try {
      const plugin = hot.getPlugin('filters');
      if (!plugin) return null;
      if (typeof plugin.getConditions === 'function') {
        const st = plugin.getConditions();
        console.debug('getHotFilterState: getConditions ->', st);
        return st;
      }
      if (typeof plugin.getState === 'function') {
        const st = plugin.getState();
        console.debug('getHotFilterState: getState ->', st);
        return st;
      }
      return null;
    } catch (e) {
      console.warn('Impossible de lire l\'état des filtres Handsontable :', e);
      return null;
    }
  }

  function restoreHotFilterState(state) {
    if (!hot || !state) return;
    try {
      console.debug('restoreHotFilterState: restoring state ->', state);
      const plugin = hot.getPlugin('filters');
      if (!plugin) return;

      // Clear existing conditions safely
      try {
        if (typeof plugin.clearAll === 'function') plugin.clearAll();
      } catch (e) {}
      const cols = hot.getSettings().columns || [];
      cols.forEach((c, i) => { try { if (typeof plugin.clearConditions === 'function') plugin.clearConditions(i); } catch (e) {} });

      // Two possible shapes: object mapping colIndex->[conds] or array of {column, conditions}
      if (Array.isArray(state)) {
        state.forEach(s => {
          const colIndex = (s && (s.column !== undefined ? s.column : s.col));
          const conds = s && (s.conditions || s.args || s[1] || s[0]);
          if (colIndex === undefined || !conds) return;
          if (Array.isArray(conds)) {
            conds.forEach(cond => {
              try {
                console.debug('restoreHotFilterState: addCondition', colIndex, cond);
                if (Array.isArray(cond)) plugin.addCondition(colIndex, cond[0], cond[1] || []);
                else if (cond && typeof cond === 'object') plugin.addCondition(colIndex, cond.operator || cond[0] || cond.name, cond.args || cond[1] || []);
              } catch (e) {}
            });
          }
        });
      } else if (state && typeof state === 'object') {
        Object.keys(state).forEach(key => {
          const colIndex = parseInt(key, 10);
          const conds = state[key];
          if (!Array.isArray(conds)) return;
          conds.forEach(cond => {
            try {
              console.debug('restoreHotFilterState: addCondition', colIndex, cond);
              if (Array.isArray(cond)) plugin.addCondition(colIndex, cond[0], cond[1] || []);
              else if (cond && typeof cond === 'object') plugin.addCondition(colIndex, cond.operator || cond[0] || cond.name, cond.args || cond[1] || []);
            } catch (e) {}
          });
        });
      }

      if (typeof plugin.filter === 'function') plugin.filter();
    } catch (e) {
      console.warn('Impossible de restaurer l\'état des filtres Handsontable :', e);
    }
  }

  function getCasExceptionnelStateMap() {
    if (!window.ACHAT_CAS_STATE) {
      try {
        const raw = localStorage.getItem('achatsCasExceptionnelState');
        window.ACHAT_CAS_STATE = raw ? JSON.parse(raw) : {};
      } catch (err) {
        window.ACHAT_CAS_STATE = {};
      }
    }
    return window.ACHAT_CAS_STATE;
  }

  function saveCasExceptionnelStateMap() {
    try {
      localStorage.setItem('achatsCasExceptionnelState', JSON.stringify(getCasExceptionnelStateMap()));
    } catch (err) {
      console.warn('Impossible de sauvegarder l\'état Cas Exceptionnel', err);
    }
  }

  function migrateCasExceptionnelKey(row) {
    if (!row || typeof row !== 'object') return;
    const oldKey = row.numero_da ? `achats-cas-${row.numero_da}` : null;
    const newKey = row.id ? `achats-cas-${row.id}` : null;
    if (!oldKey || !newKey || oldKey === newKey) return;
    const stateMap = getCasExceptionnelStateMap();
    if (Object.prototype.hasOwnProperty.call(stateMap, oldKey) && !Object.prototype.hasOwnProperty.call(stateMap, newKey)) {
      stateMap[newKey] = stateMap[oldKey];
      delete stateMap[oldKey];
      saveCasExceptionnelStateMap();
    }
  }

  function applyCasExceptionnelStateToRow(row) {
    if (!row || typeof row !== 'object') return;
    const savedValue = getCasExceptionnelValue(row);
    if (savedValue !== undefined) {
      row.cas_exceptionnel = savedValue;
    }
    migrateCasExceptionnelKey(row);
  }

  function applyCasExceptionnelStateToRows(rows) {
    if (!Array.isArray(rows)) return;
    rows.forEach(applyCasExceptionnelStateToRow);
  }

  function getCasExceptionnelKey(row) {
    if (!row) return null;
    if (row.id) return `achats-cas-${row.id}`;
    if (row.numero_da) return `achats-cas-${row.numero_da}`;
    return null;
  }

  function getCasExceptionnelValue(row) {
    const stateMap = getCasExceptionnelStateMap();
    const key = getCasExceptionnelKey(row);
    if (!key) return undefined;
    return Object.prototype.hasOwnProperty.call(stateMap, key) ? stateMap[key] : undefined;
  }

  function setCasExceptionnelValue(row, value) {
    const key = getCasExceptionnelKey(row);
    if (!key) return;
    const stateMap = getCasExceptionnelStateMap();
    stateMap[key] = Boolean(value);
    saveCasExceptionnelStateMap();
  }

  function clearSelectedCells() {
    if (!hot) return false;
    const selected = hot.getSelected && hot.getSelected();
    if (!selected || selected.length === 0) return false;

    selected.forEach(([r1, c1, r2, c2]) => {
      const sr = Math.min(r1, r2);
      const er = Math.max(r1, r2);
      const sc = Math.min(c1, c2);
      const ec = Math.max(c1, c2);
      const blankRows = Array.from({ length: er - sr + 1 }, () => Array(ec - sc + 1).fill(''));
      hot.populateFromArray(sr, sc, blankRows, null, null, 'clear');
    });

    hasLocalChanges = true;
    return true;
  }

  const NUMERIC_KEYS = new Set(columns.filter(c=>c.type==='numeric').map(c=>c.data));
  const DATE_KEYS = new Set(columns.filter(c=>c.type==='date').map(c=>c.data));

  function toDisplayDate(value) {
    if (!value) return null;
    const date = parseDate(value);
    if (!date) return String(value);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  }
  
  function formatRowDatesForDisplay(row) {
    const f = { ...row };
    for (const k of Object.keys(f)) if (DATE_KEYS.has(k)) f[k] = toDisplayDate(f[k]);
    return f;
  }
  
  function isEmptyVal(v) { return v===null||v===undefined||v===''; }
  
  function toNum(v) {
    if (isEmptyVal(v)) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  
  function isRowEmpty(row) {
    if (!row) return true;
    for (const col of columns) {
      const key = col.data;
      if (key === 'id') continue;
      const val = row[key];
      if (val !== null && val !== undefined && val !== '') return false;
    }
    return true;
  }

  function normalizeComparableValue(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
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
  }

  function toISODate(value) {
    if (!value) return null;
    const date = parseDate(value);
    if (!date) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  
  function sanitizeRowForServer(row) {
    const clean = {};
    for (const key of Object.keys(row)) {
      if (key.startsWith('_')) continue;
      let v = row[key];
      if (key === 'cas_exceptionnel' || key === 'budget_valide') {
        if (v === undefined || v === null || v === '') {
          v = null;
        } else if (typeof v === 'boolean') {
          v = v;
        } else {
          const s = String(v).trim().toLowerCase();
          if (['true','t','1','yes','y','oui','o'].includes(s)) v = true;
          else if (['false','f','0','no','n','non'].includes(s)) v = false;
          else v = null;
        }
      }
      if (DATE_KEYS.has(key)) v = toISODate(v);
      else if (NUMERIC_KEYS.has(key)) {
        if (typeof v === 'string') {
          const cleaned = v.replace(/\s/g, '').replace(',', '.');
          const num = parseFloat(cleaned);
          v = isNaN(num) ? null : num;
        } else if (typeof v === 'number') v = v;
        else v = null;
      } else if (v === '' && NUMERIC_KEYS.has(key)) v = null;
      if (v === undefined) v = null;
      clean[key] = v;
    }
    return clean;
  }

  // ============================================================
  // OPTIMISATION PERFORMANCE : plage de cellules réellement rendues
  // ============================================================
  function getRenderedRange() {
    try {
      const wtTable = hot && hot.view && hot.view.wt && hot.view.wt.wtTable;
      if (wtTable && typeof wtTable.getFirstRenderedRow === 'function') {
        return {
          rowStart: Math.max(0, wtTable.getFirstRenderedRow()),
          rowEnd: wtTable.getLastRenderedRow(),
          colStart: Math.max(0, wtTable.getFirstRenderedColumn()),
          colEnd: wtTable.getLastRenderedColumn()
        };
      }
    } catch (e) {
      // Ignorer et se rabattre sur la plage complète ci-dessous
    }
    // Repli sécurisé (comportement d'origine) si l'API interne n'est pas
    // disponible dans la version de Handsontable chargée.
    return {
      rowStart: 0,
      rowEnd: (hot && hot.countRows ? hot.countRows() : 0) - 1,
      colStart: 0,
      colEnd: (hot && hot.countCols ? hot.countCols() : 0) - 1
    };
  }

  // ============================================================
  // OPTIMISATION PERFORMANCE : traitement par lots non bloquant
  // ============================================================
  function runRowsInChunks(rowsArray, chunkSize, workFn, onComplete) {
    let index = 0;
    const scheduler = window.requestIdleCallback || window.requestAnimationFrame || function(fn) { setTimeout(fn, 16); };
    function step() {
      if (!hot) return; // table détruite/rechargée entre-temps : on arrête proprement
      const slice = rowsArray.slice(index, index + chunkSize);
      if (slice.length) {
        workFn(slice);
        index += chunkSize;
      }
      if (index < rowsArray.length) {
        scheduler(step);
      } else if (typeof onComplete === 'function') {
        onComplete();
      }
    }
    step();
  }

  // ============================================================
  // OPTIMISATION : Mise à jour readOnly par lot
  // ============================================================
  function updateRowReadOnlyState(rows) {
    if (!hot) return;

    const settings = hot.getSettings();
    const columnsDef = settings.columns || [];
    let rowsArray = Array.isArray(rows) ? rows : [rows];
    const totalRows = hot.countRows ? hot.countRows() : 0;
    if (totalRows > 10000) {
      const visibleRange = getVisibleRowRange();
      if (visibleRange) {
        rowsArray = rowsArray.filter((rowIndex) => rowIndex >= visibleRange.start && rowIndex <= visibleRange.end);
      }
      if (!rowsArray.length) return;
    }

    if (NORMALIZED_ROLE === 'cdg' || NORMALIZED_ROLE === 'back_office') {
      let changed = false;
      rowsArray.forEach(rowIndex => {
        const rowData = hot.getSourceDataAtRow(rowIndex);
        columnsDef.forEach((col, colIndex) => {
          const baseClassName = col.className || '';
          const classes = baseClassName.split(' ').filter(c => c && c !== 'htBudgetLocked' && c !== 'htBudgetRowLocked');
          const nextClassName = classes.join(' ').trim();
          const currentMeta = hot.getCellMeta(rowIndex, colIndex) || {};
          if (currentMeta.className !== nextClassName) {
            hot.setCellMeta(rowIndex, colIndex, 'className', nextClassName);
            changed = true;
          }
          if (currentMeta.readOnly !== false) {
            hot.setCellMeta(rowIndex, colIndex, 'readOnly', false);
            changed = true;
          }
        });
      });
      if (changed) scheduleHotRender();
      return;
    }

    let changed = false;

    rowsArray.forEach(rowIndex => {
      const rowData = hot.getSourceDataAtRow(rowIndex);
      if (!rowData) return;

      const montantFilled = isMontantBudgetFilled(rowData);
      const cacheKey = `${rowIndex}_${montantFilled}`;

      if (_rowReadOnlyCache[cacheKey]) return;
      _rowReadOnlyCache[cacheKey] = true;

      columnsDef.forEach((col, colIndex) => {
        const colData = col.data;
        let readOnly = true;
        let lockedByBudget = false;

        if (colData === 'montant_budget') {
          readOnly = true;
        } else if (AUTO_LOCKED_FIELDS.has(colData)) {
          readOnly = true;
        } else if (montantFilled) {
          readOnly = !isColumnEditableWhenFilled(colData);
          lockedByBudget = readOnly;
        } else {
          readOnly = false;
        }

        const baseClassName = col.className || '';
        const classes = baseClassName.split(' ').filter(c => c && c !== 'htBudgetLocked' && c !== 'htBudgetRowLocked');
        if (lockedByBudget) classes.push('htBudgetLocked');
        const nextClassName = classes.join(' ').trim();
        const currentMeta = hot.getCellMeta(rowIndex, colIndex) || {};

        if (currentMeta.readOnly !== readOnly || currentMeta.className !== nextClassName) {
          hot.setCellMeta(rowIndex, colIndex, 'readOnly', readOnly);
          hot.setCellMeta(rowIndex, colIndex, 'className', nextClassName);
          changed = true;
        }
      });
    });

    if (changed) scheduleHotRender();
  }

  // ============================================================
  // FONCTION DE SAUVEGARDE OPTIMISÉE
  // ============================================================
  async function autoSaveDossiers() {
    if (isSaving) { pendingSave = true; return; }
    isSaving = true;
    try {
      let currentData = hot.getSourceData();
      const uniqueCurrentData = deduplicateAchatRows(currentData);
      if (uniqueCurrentData.length !== currentData.length) {
        isBackgroundRefresh = true;
        try {
          hot.loadData(uniqueCurrentData);
        } finally {
          isBackgroundRefresh = false;
        }
        currentData = hot.getSourceData();
      }
      const snapshotMap = new Map();
      const snapshotByDa = new Map();
      (Array.isArray(savedSnapshot) ? savedSnapshot : []).forEach((row) => {
        if (!row || typeof row !== 'object') return;
        if (row.id !== undefined && row.id !== null && row.id !== '') snapshotMap.set(String(row.id), row);
        if (Number.isInteger(Number(row.id)) && Number(row.id) > 0 && row.numero_da !== undefined && row.numero_da !== null && String(row.numero_da).trim() !== '') {
          snapshotByDa.set(String(row.numero_da).trim().toLowerCase(), row);
        }
      });
      (Array.isArray(ALL_DATA) ? [...ALL_DATA].reverse() : []).forEach((row) => {
        if (!row || typeof row !== 'object') return;
        const rowId = Number(row.id);
        const rowDa = row.numero_da !== undefined && row.numero_da !== null
          ? String(row.numero_da).trim().toLowerCase()
          : '';
        if (Number.isInteger(rowId) && rowId > 0 && rowDa && !snapshotByDa.has(rowDa)) {
          snapshotByDa.set(rowDa, row);
        }
      });

      const changes = [];
      for (let i = 0; i < currentData.length; i++) {
        const row = currentData[i];
        if (isRowEmpty(row)) continue;
        if (!row || typeof row !== 'object') continue;

        const rowDa = row.numero_da !== undefined && row.numero_da !== null
          ? String(row.numero_da).trim().toLowerCase()
          : '';
        let original = null;
        if (row.id !== undefined && row.id !== null && row.id !== '') {
          original = snapshotMap.get(String(row.id)) || null;
        }
        if (!original && rowDa) {
          original = snapshotByDa.get(rowDa) || null;
        }
        if (!original) {
          changes.push({ method: 'POST', row, index: i });
          continue;
        }

        const originalId = Number(original.id);
        if (!Number.isInteger(originalId) || originalId <= 0) {
          changes.push({ method: 'POST', row, index: i });
          continue;
        }
        row.id = originalId;

        const mergedRow = { ...(original || {}), ...(row || {}) };
        const changedFields = Object.keys(mergedRow).filter(key => {
          if (key === 'id' || key.startsWith('_')) return false;
          return normalizeComparableValue(mergedRow[key]) !== normalizeComparableValue(original?.[key]);
        });

        const isCdgRole = NORMALIZED_ROLE === 'cdg';
        const isBackOfficeRole = NORMALIZED_ROLE === 'back_office';

        if (isCdgRole) {
          const cdgAllowedFields = ['code_budget', 'montant_budget', 'montant_ht', 'ecart_budget', 'statut_budget', 'ecart_pourcentage', 'gain_achat'];
          const cdgChangedFields = changedFields.filter(field => {
            if (field === 'montant_budget' && String(row.pv_numero || '').trim() === '') return false;
            return cdgAllowedFields.includes(field);
          });

          if (cdgChangedFields.length > 0) {
            const cdgPayload = {};
            cdgChangedFields.forEach(field => {
              if (normalizeComparableValue(row[field]) !== normalizeComparableValue(original?.[field])) {
                cdgPayload[field] = row[field];
              }
            });
            if (Object.keys(cdgPayload).length > 0) {
              changes.push({
                method: 'PUT',
                id: row.id,
                row: cdgPayload,
                index: i,
                originalRow: original
              });
            }
          }
          continue;
        }

        if (isBackOfficeRole) {
          const boAllowedFields = ['num_bc', 'date_envoi_bc', 'periode_bc', 'nb_bc', 'date_envoi_cdg',
                                   'date_paiement', 'date_prevue_livraison', 'date_reception_facture', 'numero_facture',
                                   'bl', 'be', 'date_transmission', 'statut', 'categorie_achat',
                                   'obs', 'cas_exceptionnel', 'action_requise', 'priorite', 'budget_valide'];
          const boChangedFields = changedFields.filter(field => boAllowedFields.includes(field));

          if (boChangedFields.length > 0) {
            const boPayload = {};
            boChangedFields.forEach(field => {
              if (normalizeComparableValue(row[field]) !== normalizeComparableValue(original?.[field])) {
                boPayload[field] = row[field];
              }
            });
            if (Object.keys(boPayload).length > 0) {
              changes.push({
                method: 'PUT',
                id: row.id,
                row: boPayload,
                index: i,
                originalRow: original
              });
            }
          }
          continue;
        }

        if (changedFields.length > 0) {
          changes.push({ method: 'PUT', id: row.id, row: mergedRow, index: i, originalRow: original });
        }
      }

      if (changes.length === 0 && hasLocalChanges) {
        const fallbackRows = currentData.filter(row => row && typeof row === 'object' && !isRowEmpty(row));
        const fallbackChange = fallbackRows.some(row => {
          if (row.id === undefined || row.id === null || row.id === '') return true;
          const original = snapshotMap.get(String(row.id));
          if (!original) return true;
          const unionKeys = new Set([...Object.keys(row), ...Object.keys(original)]);
          for (const key of unionKeys) {
            if (key === 'id' || key.startsWith('_')) continue;
            if (normalizeComparableValue(row[key]) !== normalizeComparableValue(original[key])) return true;
          }
          return false;
        });
        if (!fallbackChange) {
          statusEl.innerText = 'ℹ️ Aucune modification.';
          isSaving = false;
          if (pendingSave) { pendingSave = false; autoSaveDossiers(); }
          return;
        }
      }
      
      if (changes.length === 0) {
        statusEl.innerText = 'ℹ️ Aucune modification.';
        isSaving = false;
        if (pendingSave) { pendingSave = false; autoSaveDossiers(); }
        return;
      }
      
      let successCount = 0, errorCount = 0;
      statusEl.innerText = `⏳ Sauvegarde de ${changes.length} ligne(s)...`;

      // Préparer payloads batch
      const postChanges = changes.filter(c => c.method === 'POST');
      const putChanges = changes.filter(c => c.method === 'PUT');

      const insertsPayload = postChanges.map(c => sanitizeRowForServer(c.row));
      const updatesPayload = [];
      const invalidUpdateIds = [];
      putChanges.forEach(c => {
        const rawId = c.id;
        let idNum = NaN;
        if (Number.isInteger(rawId)) idNum = rawId;
        else if (typeof rawId === 'string' && rawId.trim() !== '') idNum = parseInt(rawId, 10);
        if (!Number.isInteger(idNum) || Number.isNaN(idNum)) {
          invalidUpdateIds.push(rawId);
          return;
        }
        updatesPayload.push({ id: idNum, row: sanitizeRowForServer(c.row) });
      });
      if (invalidUpdateIds.length > 0) {
        console.warn('autoSaveDossiers: Ignoring updates with invalid ids', invalidUpdateIds);
        // Inform the user but don't block the batch
        statusEl.innerText = `⚠️ Ignoré ${invalidUpdateIds.length} mise(s) à jour sans ID valide.`;
      }

      try {
        const token = localStorage.getItem('authToken');
        const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

        const response = await fetch(apiUrl('/api/achats/batch'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ inserts: insertsPayload, updates: updatesPayload })
        });

        if (response && response.ok) {
          const result = await response.json();
          const inserted = Array.isArray(result.inserted) ? result.inserted : (result.inserted ? [result.inserted] : []);
          const updatedRes = Array.isArray(result.updated) ? result.updated : (result.updated ? [result.updated] : []);

          // Appliquer inserts (correspondance par ordre)
          for (let i = 0; i < inserted.length; i++) {
            const rawSaved = inserted[i];
            const saved = rawSaved ? formatRowDatesForDisplay(rawSaved) : rawSaved;
            const change = postChanges[i];
            if (saved && saved.id && change) {
              if (change.row && typeof change.row === 'object') change.row.id = saved.id;
              const sourceData = hot.getSourceData();
              if (Array.isArray(sourceData) && typeof change.index === 'number' && sourceData[change.index]) {
                Object.assign(sourceData[change.index], saved);
              }
              const enriched = enrichData([saved])[0];
              replaceAchatCacheRow(ALL_DATA, enriched);
              replaceAchatCacheRow(FILTERED, enriched);
              successCount++;
            }
          }

          // Appliquer updates
          for (let i = 0; i < updatedRes.length; i++) {
            const rawSaved = updatedRes[i];
            const saved = rawSaved ? formatRowDatesForDisplay(rawSaved) : rawSaved;
            if (saved && saved.id) {
              const idx = ALL_DATA.findIndex(o => String(o?.id) === String(saved.id));
              const enriched = enrichData([saved])[0];
              if (idx === -1) replaceAchatCacheRow(ALL_DATA, enriched);
              else ALL_DATA[idx] = enriched;
              replaceAchatCacheRow(FILTERED, enriched);
              successCount++;
            }
          }

          const uniqueSourceData = deduplicateAchatRows(hot.getSourceData());
          if (uniqueSourceData.length !== hot.getSourceData().length) {
            isBackgroundRefresh = true;
            try {
              hot.loadData(uniqueSourceData);
            } finally {
              isBackgroundRefresh = false;
            }
          }
        } else {
          let errBody = '';
          try {
            const txt = await response.text();
            try { errBody = JSON.parse(txt); } catch (e) { errBody = txt; }
          } catch (e) { errBody = String(e); }
          console.error('Erreur batch save :', response.status, errBody);
          const errDisplay = (typeof errBody === 'string') ? errBody : JSON.stringify(errBody);
          statusEl.innerText = `❌ Erreur sauvegarde: ${response.status} ${errDisplay}`;
          errorCount = changes.length;
        }
      } catch (err) {
        console.error('Erreur network batch save:', err);
        errorCount = changes.length;
        statusEl.innerText = `❌ Échec réseau lors de la sauvegarde : ${err.message || err}`;
      }

      if (errorCount > 0) {
        hasLocalChanges = true;
        return;
      }
      
      const updatedData = hot.getSourceData();
      applyCasExceptionnelStateToRows(updatedData);
      // Appliquer les modifications directement sur les objets source pour
      // éviter de recharger complètement la table (préserve l'état des filtres)
      try {
        const source = hot.getSourceData();
        if (Array.isArray(source)) {
          for (let i = 0; i < updatedData.length; i++) {
            const src = source[i];
            const upd = updatedData[i];
            if (!src || !upd) continue;
            Object.keys(upd).forEach(k => { src[k] = upd[k]; });
          }
        }
      } catch (e) {
        console.warn('Erreur application modifications in-place :', e);
      }
      const deduplicatedData = deduplicateAchatRows(updatedData);
      ALL_DATA = deduplicateAchatRows(ALL_DATA);
      FILTERED = deduplicateAchatRows(FILTERED);
      savedSnapshot = cloneAchatData(deduplicatedData);
      hasLocalChanges = false;
      try {
        if (typeof populateFilters === 'function') populateFilters();
        if (typeof saveFilterState === 'function') saveFilterState();
      } catch (e) { console.warn('Erreur lors du rafraîchissement des filtres :', e); }
      const activeTab = document.querySelector('.tab-content.active')?.id;
      const hotFilterState = (activeTab === 'tab-dossiers' && hot) ? getHotFilterState() : null;
      if (hot && typeof hot.render === 'function') hot.render();
      if (activeTab !== 'tab-dossiers') {
        render();
      } else if (hotFilterState && typeof restoreHotFilterState === 'function') {
        restoreHotFilterState(hotFilterState);
      }
      statusEl.innerText = `✅ ${successCount} ligne(s) sauvegardée(s), ${errorCount} erreur(s).`;
    } catch (err) {
      console.error('Erreur dans autoSaveDossiers :', err);
      statusEl.innerText = '❌ Erreur lors de la sauvegarde.';
    } finally {
      isSaving = false;
      if (pendingSave) {
        pendingSave = false;
        autoSaveDossiers();
      } else if (!hasLocalChanges && pendingDataUpdatedEvent) {
        // Aucune modification locale en attente : on peut rejouer en toute
        // sécurité le rafraîchissement en arrière-plan qui avait été ignoré
        // pendant que l'utilisateur éditait / que la sauvegarde était en cours.
        const ev = pendingDataUpdatedEvent;
        pendingDataUpdatedEvent = null;
        document.dispatchEvent(ev);
      } else if (!hasLocalChanges && pendingSilentSync) {
        pendingSilentSync = false;
        syncChangedAchatRows();
      }
    }
  }

  async function deleteRowOnServer(ids) {
    if (!Array.isArray(ids)) ids = [ids];
    if (ids.length === 0) return;

    try {
      const token = localStorage.getItem('authToken');
      const headers = token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
      const response = await fetch(apiUrl('/api/achats'), {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ ids })
      });
      if (response.ok) {
        const result = await response.json();
        const deletedIds = Array.isArray(result.deleted) ? result.deleted : ids;
        deletedIds.forEach(id => {
          const idx = ALL_DATA.findIndex(o => o.id === id);
          if (idx !== -1) ALL_DATA.splice(idx, 1);
          const fIdx = FILTERED.findIndex(o => o.id === id);
          if (fIdx !== -1) FILTERED.splice(fIdx, 1);
        });
        const currentData = hot.getSourceData();
        const remainingData = currentData.filter(row => !deletedIds.includes(row && row.id));
        // Supprimer les éléments en place dans le source data pour préserver l'état des filtres
        try {
          const source = hot.getSourceData();
          if (Array.isArray(source)) {
            // Retirer en manipulant le tableau source
            for (let i = source.length - 1; i >= 0; i--) {
              const r = source[i];
              if (r && r.id && deletedIds.includes(r.id)) {
                source.splice(i, 1);
              }
            }
          }
        } catch (e) {
          console.warn('Erreur suppression in-place :', e);
        }
        savedSnapshot = cloneAchatData(hot.getSourceData());
        hasLocalChanges = false;
        try {
          if (typeof populateFilters === 'function') populateFilters();
          if (typeof saveFilterState === 'function') saveFilterState();
        } catch (e) { console.warn('Erreur lors du rafraîchissement des filtres :', e); }
        const activeTab = document.querySelector('.tab-content.active')?.id;
        const hotFilterState = (activeTab === 'tab-dossiers' && hot) ? getHotFilterState() : null;
        if (hot && typeof hot.render === 'function') hot.render();
        if (activeTab !== 'tab-dossiers') {
          render();
        } else if (hotFilterState && typeof restoreHotFilterState === 'function') {
          restoreHotFilterState(hotFilterState);
        }
        statusEl.innerText = `🗑️ ${deletedIds.length} ligne(s) supprimée(s).`;
      } else {
        const err = await response.text();
        alert('Erreur suppression : ' + err);
      }
    } catch (err) {
      console.error(err);
      alert('Erreur réseau.');
    }
  }

  function ensureTrailingEmptyRow() {
    if (!hot) return;
    hot.updateSettings({ minSpareRows: minSpareAchatRows });
  }

  function achatHasPendingLocalChanges() {
    return hasLocalChanges;
  }

  window.achatsHasPendingLocalChanges = achatHasPendingLocalChanges;

  // ---------- Fonction qui applique les classes aux en‑têtes ----------
  function applyHeaderClasses() {
    if (!hot) return;
    const container = hotContainer;
    const headerCells = Array.from(container.querySelectorAll('.ht_clone_top thead th, .ht_master .htCore thead th'));
    if (!headerCells.length) return;

    const primaryCutoff = columns.findIndex(c => c.data === 'pv_numero');

    function computeHeaderStart(th) {
      const cells = Array.from(th.parentElement.children);
      let start = 0;
      for (const cell of cells) {
        if (cell === th) break;
        start += parseInt(cell.getAttribute('colspan'), 10) || 1;
      }
      if (cells.length > 0 && cells[0] === th && !th.hasAttribute('data-col')) {
        return -1;
      }
      if (cells.length > 0 && cells[0] && !cells[0].hasAttribute('data-col')) {
        start -= 1;
      }
      return start;
    }

    headerCells.forEach(th => {
      const dataCol = th.hasAttribute('data-col') ? parseInt(th.getAttribute('data-col'), 10) : NaN;
      let effectiveIndex = Number.isInteger(dataCol) && dataCol >= 0 ? dataCol : computeHeaderStart(th);
      if (effectiveIndex < 0) return;
      const className = effectiveIndex <= primaryCutoff ? 'ht-header-group-primary' : 'ht-header-group-secondary';
      const baseClass = th.className.split(' ').filter(c => !c.startsWith('ht-header-')).join(' ').trim();
      th.className = `${baseClass} ${className}`.trim();
    });
  }
  

  // ------------------------------------------------------------
  // AMÉLIORATIONS POUR LES LISTES DÉROULANTES
  // ------------------------------------------------------------
  function enhanceDropdownNavigation() {
    if (!hot) return;
    
    hot.addHook('beforeKeyDown', function(event) {
      const activeEditor = hot.getActiveEditor();
      if (!activeEditor) return;
      
      if (activeEditor.isOpened && activeEditor.list) {
        const key = event.key;
        const list = activeEditor.list;
        
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          
          const currentIndex = list.getHighlightedIndex();
          const totalItems = list.items ? list.items.length : 0;
          const newIndex = key === 'ArrowDown' 
            ? (currentIndex < totalItems - 1 ? currentIndex + 1 : 0)
            : (currentIndex > 0 ? currentIndex - 1 : totalItems - 1);
          
          if (list.setHighlightedIndex) {
            list.setHighlightedIndex(newIndex);
          }
          if (list.scrollToHighlighted) {
            list.scrollToHighlighted();
          }
        }
        else if (key === 'Enter') {
          event.preventDefault();
          const currentIndex = list.getHighlightedIndex();
          if (currentIndex >= 0 && list.items && currentIndex < list.items.length) {
            activeEditor.setValue(list.items[currentIndex]);
          }
          // Valide toujours l'édition (item choisi dans la liste OU saisie libre
          // tapée par l'utilisateur, la liste étant non stricte).
          activeEditor.finishEditing(false);
        }
        else if (key === 'Escape') {
          event.preventDefault();
          // Annule l'édition et restaure l'ancienne valeur.
          activeEditor.finishEditing(true);
        }
      }
    });
  }

  function setupTextSelection() {
    if (!hot) return;
    
    hot.addHook('beforeKeyDown', function(event) {
      const activeEditor = hot.getActiveEditor();
      if (!activeEditor) return;
      
      if (event.ctrlKey && event.key === 'a' && activeEditor.input) {
        event.preventDefault();
        activeEditor.input.select();
      }
    });
  }

  function setupTabNavigation() {
    if (!hot) return;
    hot.addHook('afterBeginEditing', function(row, col) {
      const editor = hot.getActiveEditor();
      if (editor && editor.input) {
        const len = editor.input.value ? editor.input.value.length : 0;
        if (typeof editor.input.setSelectionRange === 'function') {
          editor.input.setSelectionRange(len, len);
        } else {
          editor.input.focus();
        }
      }
    });
  }

  // ============================================================
  // Initialisation de la table
  // ============================================================
  window.initDossiersTable = function(data) {
    let displayData = data;
    if (displayData === undefined || displayData === null) {
      displayData = [];
    }
    const sourceData = Array.isArray(displayData) ? displayData : [];
    const pagedData = getDisplayRowsForCurrentPage(sourceData);
    const formattedData = pagedData.map(r => formatRowDatesForDisplay(r));
    // Nombre de lignes non vides pour calculer le nombre minimal de lignes
    const minRowsValueGlobal = formattedData.length;
    applyCasExceptionnelStateToRows(formattedData);
    savedSnapshot = cloneAchatData(formattedData);
    hasLocalChanges = false;

    if (hot) {
      hot.updateSettings({
        data: formattedData,
        minRows: minRowsValueGlobal
      });
      if (NORMALIZED_ROLE !== 'cdg' && NORMALIZED_ROLE !== 'back_office') {
        setTimeout(() => {
          if (!hot) return;
          _rowReadOnlyCache = {};
          const rows = hot.countRows ? hot.countRows() : 0;
          if (rows > 0) {
            const allRows = Array.from({ length: rows }, (_, i) => i);
            runRowsInChunks(allRows, 200, (slice) => updateRowReadOnlyState(slice));
          }
          if (typeof hot.render === 'function') {
            hot.render();
          }
        }, 100);
      }
      setTimeout(() => {
        applyHeaderClasses();
        enhanceDropdownNavigation();
        setupTextSelection();
        setupTabNavigation();
        if (hot && canRenderDossiersTable()) {
          hot.updateSettings({ height: computeHotHeight() });
        }
        document.dispatchEvent(new CustomEvent('dossiersTableReady'));
      }, 0);
    } else {
      if (typeof Handsontable === 'undefined') {
        setTimeout(() => bootstrapDossiersTable(displayData), 100);
        return;
      }
      if (!canRenderDossiersTable()) {
        setTimeout(() => bootstrapDossiersTable(displayData), 150);
        return;
      }
      
      const jumpToLastNonEmptyRow = (event) => {
        if (!hot || !(event.ctrlKey || event.metaKey) || (event.key !== 'ArrowDown' && event.keyCode !== 40)) return false;
        const activeEditor = hot.getActiveEditor();
        if (activeEditor && activeEditor.isOpened) return false;

        let lastNonEmptyRow = -1;
        for (let rowIndex = hot.countRows() - 1; rowIndex >= 0; rowIndex -= 1) {
          const rowData = hot.getDataAtRow(rowIndex) || [];
          if (rowData.some(value => value !== null && value !== undefined && String(value).trim() !== '')) {
            lastNonEmptyRow = rowIndex;
            break;
          }
        }
        if (lastNonEmptyRow < 0) return false;

        const selected = hot.getSelectedLast();
        const currentColumn = selected ? selected[1] : 0;
        event.preventDefault();
        event.stopPropagation();
        hot.selectCell(lastNonEmptyRow, currentColumn);
        if (typeof hot.scrollViewportTo === 'function') {
          hot.scrollViewportTo(lastNonEmptyRow, currentColumn);
        }
        return true;
      };

      const config = {
        data: formattedData,
        columns: effectiveColumns,
        colWidths: 200,
        rowHeight: 27,
        rowHeaders: true,
        rowHeaderWidth: 50,
        autoRowSize: false,
        autoColumnSize: false,
        manualRowResize: false,
        renderAllRows: false,
        viewportRowRenderingOffset: 12,
        viewportColumnRenderingOffset: 2,
        colHeaders: true,
        columnHeaderHeight: 46,
        language: 'fr-FR',
        contextMenu: false,
        copyPaste: {
          rowsLimit: 10000,
          columnsLimit: 100
        },
        filters: true,
        dropdownMenu: {
          items: {
            filter_by_condition: {
              name: 'Filtrer par conditions'
            },
            filter_by_value: {
              name: 'Filtrer par valeurs'
            },
            filter_action_bar: {
              name: 'Actions'
            }
          }
        },
        manualColumnResize: false,
        stretchH: 'none',
        columnSorting: true,
        minRows: minRowsValueGlobal,
        minSpareRows: minSpareAchatRows,
        fixedColumnsLeft: 2,
        height: computeHotHeight(),
        licenseKey: 'non-commercial-and-evaluation',

        currentRowClassName: 'htActiveRow',
        outsideClickDeselects: false,
        enterBeginsEditing: false,
        
        // ============================================================
        // afterChange - Met à jour l'état readOnly
        // ============================================================
        afterChange: function(changes, source) {
          if (source === 'loadData' || source === 'autoCalc' || isBackgroundRefresh) return;
          if (!changes) return;
          hasLocalChanges = true;

          const changedRows = new Set(changes.map(([row]) => row));
          changedRows.forEach((rowIndex) => {
            const rowData = hot.getSourceDataAtRow(rowIndex);
            if (!rowData) return;
            const derivedFields = calculateAchatDerivedFields(rowData);
            Object.entries(derivedFields).forEach(([field, value]) => {
              if (normalizeComparableValue(rowData[field]) !== normalizeComparableValue(value)) {
                hot.setDataAtRowProp(rowIndex, field, value, 'autoCalc');
              }
            });
          });

          const currentOwner = getCurrentAchatOwner();
          if (currentOwner) {
            changes.forEach(([row]) => {
              const dataRow = hot.getSourceDataAtRow(row);
              if (dataRow && !dataRow.id && !String(dataRow.acheteur || '').trim() && !isRowEmpty(dataRow)) {
                hot.setDataAtRowProp(row, 'acheteur', currentOwner, 'setOwner');
              }
            });
          }
          
          let montantBudgetChanged = false;
          const affectedRows = new Set();
          
          changes.forEach(([row, prop, oldValue, newValue]) => {
            if (prop === 'cas_exceptionnel') {
              const dataRow = hot.getSourceDataAtRow(row);
              if (dataRow) setCasExceptionnelValue(dataRow, newValue);
            }
            if (prop === 'montant_budget') {
              montantBudgetChanged = true;
              affectedRows.add(row);
            }
          });
          
          // Mise à jour optimisée
          if (montantBudgetChanged && NORMALIZED_ROLE !== 'cdg') {
            // Vider le cache pour les lignes affectées
            affectedRows.forEach(row => {
              Object.keys(_rowReadOnlyCache).forEach(key => {
                if (key.startsWith(`${row}_`)) delete _rowReadOnlyCache[key];
              });
            });
            if (hot) {
              scheduleRowReadOnlyStateUpdate(Array.from(affectedRows));
            }
          }
          clearTimeout(saveTimeout);
          saveTimeout = setTimeout(() => { autoSaveDossiers(); }, 800);
          ensureTrailingEmptyRow();
        },
        afterValidate: function(isValid) {
          if (isValid) resumePendingRefreshAfterValidation();
        },
        // ============================================================
        // afterLoadData - Initialisation optimisée (règles appliquées à
        // TOUTES les lignes dès le chargement, sans bloquer l'interface)
        // ============================================================
        afterLoadData: function() {
          if (!hot) return;
          
          try {
            const rows = hot.countRows ? hot.countRows() : 0;
            if (rows > 0) {
              _rowReadOnlyCache = {};
              const visibleRange = getVisibleRowRange();
              const rowsToProcess = visibleRange
                ? Array.from({ length: Math.max(1, visibleRange.end - visibleRange.start + 1) }, (_, i) => visibleRange.start + i)
                : Array.from({ length: rows }, (_, i) => i);
              setTimeout(() => {
                if (!hot) return;
                if (NORMALIZED_ROLE === 'cdg') {
                  applyCdgNoBudgetColoring();
                } else if (NORMALIZED_ROLE !== 'back_office') {
                  runRowsInChunks(rowsToProcess, rowsToProcess.length > 500 ? 80 : 200, (slice) => updateRowReadOnlyState(slice));
                }
              }, 100);
            }
          } catch (e) {
            // Ignorer les erreurs pendant l'initialisation
          }
        },
        
        // ============================================================
        // afterRender - Sécurisé et optimisé pour la performance
        // ============================================================
        afterRender: function() {
          if (!hot) return;
          const now = Date.now();
          if (__isScrolling) return;
          if (now - _lastRenderStamp < 90) return;
          _lastRenderStamp = now;

          applyHeaderClasses();
          applyExcelCopyMarker();
          applyExcelSelectionMarker();

          if (NORMALIZED_ROLE === 'cdg') {
            requestAnimationFrame(() => {
              if (hot) applyCdgNoBudgetColoring();
            });
            return;
          }

          if (NORMALIZED_ROLE !== 'back_office') {
            try {
              const rows = hot.countRows ? hot.countRows() : 0;
              if (rows > 0 && Object.keys(_rowReadOnlyCache).length === 0) {
                const visibleRange = getVisibleRowRange();
                const rowsToProcess = visibleRange
                  ? Array.from({ length: Math.max(1, visibleRange.end - visibleRange.start + 1) }, (_, i) => visibleRange.start + i)
                  : Array.from({ length: rows }, (_, i) => i);
                requestAnimationFrame(() => {
                  runRowsInChunks(rowsToProcess, rowsToProcess.length > 500 ? 80 : 200, (slice) => {
                    if (hot && !__isScrolling) updateRowReadOnlyState(slice);
                  });
                });
              }
            } catch (e) {
              // Ignorer les erreurs
            }
          }
        },
        
        beforeBeginEditing: function(row, col) {
          return false;
        },
        
        beforeScrollVertically: function() {
          __isScrolling = true;
          if (__scrollIdleTimer) clearTimeout(__scrollIdleTimer);
        },
        beforeScrollHorizontally: function() {
          __isScrolling = true;
          if (__scrollIdleTimer) clearTimeout(__scrollIdleTimer);
        },
        afterScrollVertically: function() {
          __isScrolling = true;
          if (__scrollIdleTimer) clearTimeout(__scrollIdleTimer);
          __scrollIdleTimer = setTimeout(() => {
            __isScrolling = false;
            if (hot) {
              positionCopyOverlay();
              positionSelectionOverlay();
              applyHeaderClasses();
              const visibleRange = getVisibleRowRange();
              if (visibleRange) {
                const visibleRows = Array.from(
                  { length: visibleRange.end - visibleRange.start + 1 },
                  (_, index) => visibleRange.start + index
                );
                _rowReadOnlyCache = {};
                if (NORMALIZED_ROLE === 'cdg') {
                  applyCdgNoBudgetColoring();
                } else {
                  updateRowReadOnlyState(visibleRows);
                }
              }
            }
          }, 120);
          loadNextPageIfNeeded(hot.getLastVisibleRow ? hot.getLastVisibleRow() : (hot.countRows() - 1));
        },
        afterScrollHorizontally: function() {
          __isScrolling = true;
          if (__scrollIdleTimer) clearTimeout(__scrollIdleTimer);
          __scrollIdleTimer = setTimeout(() => {
            __isScrolling = false;
            if (hot) {
              positionCopyOverlay();
              positionSelectionOverlay();
              applyHeaderClasses();
            }
          }, 120);
        },
        afterSelectionEnd: function(row, col, row2, col2) {
          excelSelectionCoords = { startRow: row, startCol: col, endRow: row2, endCol: col2 };
          applyExcelSelectionMarker();
        },
        beforePaste: function(data, coords) {
          return false;
        },
        afterDeselect: function() {
          clearExcelSelectionMarker();
        },
        afterCopy: function(data, coords) {
          if (coords && coords.length) {
            excelCopyMarkerCoords = {
              startRow: coords[0].startRow,
              startCol: coords[0].startCol,
              endRow: coords[0].endRow,
              endCol: coords[0].endCol
            };
            applyExcelCopyMarker();
          }
          showStatusMessage('Sélection copiée');
        },
        afterCut: function() {
          clearExcelCopyMarker();
          showStatusMessage('Sélection coupée');
        },
        afterPaste: function() {
          clearExcelCopyMarker();
          showStatusMessage('Contenu collé');
        },
        beforeKeyDown: function(event) {
          if (!hot) return;
          if (jumpToLastNonEmptyRow(event)) return;
          const key = event.key;
          if (key === 'Delete' || key === 'Backspace') {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        },
        beforeRemoveRow: function(index, amount, physicalRows) {
          pendingDeleteIds = [];
          return false;
        },
        afterRemoveRow: function() {
          const ids = pendingDeleteIds;
          pendingDeleteIds = [];
          if (ids.length > 0) {
            deleteRowOnServer(ids);
          }
        }
      };
      
      hot = new Handsontable(hotContainer, config);
      window.hot = hot;
      if (hotContainer.__jumpToLastNonEmptyRow) {
        hotContainer.removeEventListener('keydown', hotContainer.__jumpToLastNonEmptyRow, true);
      }
      hotContainer.__jumpToLastNonEmptyRow = jumpToLastNonEmptyRow;
      hotContainer.addEventListener('keydown', jumpToLastNonEmptyRow, true);
      ensureTrailingEmptyRow();
      
      setTimeout(() => {
        applyHeaderClasses();
        enhanceDropdownNavigation();
        setupTextSelection();
        setupTabNavigation();
        document.dispatchEvent(new CustomEvent('dossiersTableReady'));
      }, 100);
    }
    statusEl.innerText = `✅ ${formattedData.length} lignes affichées dans le tableau.`;
  };

  function canRenderDossiersTable() {
    if (!hotContainer) return false;
    const tabContent = hotContainer.closest('.tab-content');
    if (!tabContent) return true;
    const style = window.getComputedStyle(tabContent);
    const rect = tabContent.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function bootstrapDossiersTable(data) {
    if (!canRenderDossiersTable()) {
      setTimeout(() => bootstrapDossiersTable(data), 150);
      return;
    }
    initDossiersTable(data);
  }

  // Chargement initial
  if (ALL_DATA.length > 0) {
    bootstrapDossiersTable(FILTERED);
  } else if (localStorage.getItem('authToken')) {
    setTableLoadingIndicator(true);
    loadDataFromAPI()
      .then(() => {
        if (ALL_DATA.length > 0) bootstrapDossiersTable(FILTERED);
      })
      .finally(() => setTableLoadingIndicator(false));
  }

  const origSwitch = window.switchTab;
  window.switchTab = function(tab) {
    origSwitch(tab);
    if (tab === 'dossiers') {
      setTimeout(() => {
        if (hot && canRenderDossiersTable()) {
          hot.updateSettings({ height: computeHotHeight() });
        }
      }, 50);
    }
  };

  // Échap efface le marquage de copie
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      clearExcelCopyMarker();
    }
  });

  // recalcul de la hauteur au redimensionnement
  let resizeTimeout = null;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (hot && canRenderDossiersTable()) {
        hot.updateSettings({ height: computeHotHeight() });
        positionCopyOverlay();
        positionSelectionOverlay();
      }
    }, 150);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function() {
      if (hot && canRenderDossiersTable()) {
        hot.updateSettings({ height: computeHotHeight() });
      }
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    mountAchatTemplate();
  } else {
    document.addEventListener('DOMContentLoaded', mountAchatTemplate, { once: true });
  }

  // ------------------------------------------------------------
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState !== 'visible') return;
    if (!hot || !canRenderDossiersTable()) return;
    // CDG : ne pas appliquer les règles de couleur
    if (NORMALIZED_ROLE === 'cdg' || NORMALIZED_ROLE === 'back_office') return;
    try {
      const rows = hot.countRows ? hot.countRows() : 0;
      if (rows <= 0) return;
      _rowReadOnlyCache = {};
      const allRows = Array.from({ length: rows }, (_, i) => i);
      runRowsInChunks(allRows, 200, (slice) => {
        if (hot) updateRowReadOnlyState(slice);
      });
    } catch (e) {
      // Ignorer les erreurs de revalidation en arrière-plan
    }
  });

  // ============================================================
  // ACTUALISATION AUTOMATIQUE POUR HANDSONTABLE
  // ============================================================
  // Écouter les événements de mise à jour des données
  document.addEventListener('dataUpdated', function(event) {
    const newData = event.detail && event.detail.data;
    if (!newData || !Array.isArray(newData)) return;
    
    // Vérifier si l'onglet Dossiers est actif
    const dossiersTab = document.getElementById('tab-dossiers');
    if (!dossiersTab || !dossiersTab.classList.contains('active')) return;

    // ------------------------------------------------------------
    // GARDE ANTI-ÉCRASEMENT : si des modifications locales sont en
    // cours d'édition ou en cours de sauvegarde, on ne remplace pas
    // les données maintenant (ça écraserait la saisie de l'utilisateur
    // avant qu'elle ne soit envoyée au serveur). On mémorise l'événement
    // pour le rejouer automatiquement dès que la sauvegarde sera terminée
    // (voir le bloc `finally` de autoSaveDossiers), afin de ne jamais
    // perdre complètement un rafraîchissement en arrière-plan.
    // ------------------------------------------------------------
    if (hasLocalChanges || isSaving || pendingSave) {
      pendingDataUpdatedEvent = event;
      console.debug('dataUpdated différé : modifications locales en attente de sauvegarde');
      return;
    }
    
    // Mettre à jour Handsontable avec les nouvelles données
    if (hot && typeof hot.getSettings === 'function') {
      try {
        // Formater les données
        const formattedData = newData.map(r => {
          const row = { ...r };
          Object.keys(row).forEach(key => {
            if (DATE_KEYS.has(key)) {
              row[key] = toDisplayDate(row[key]);
            }
          });
          return row;
        });
        
        // Appliquer l'état Cas Exceptionnel
        applyCasExceptionnelStateToRows(formattedData);
        
        // Sauvegarder l'état des filtres
        const hotFilterState = getHotFilterState ? getHotFilterState() : null;
        
        // Mettre à jour les données
        hot.updateSettings({ data: formattedData });
        savedSnapshot = cloneAchatData(formattedData);
        hasLocalChanges = false;
        
        // Restaurer les filtres
        if (hotFilterState && typeof restoreHotFilterState === 'function') {
          setTimeout(() => {
            restoreHotFilterState(hotFilterState);
          }, 100);
        }
        
        // Réappliquer les couleurs/états des lignes après actualisation
        if (NORMALIZED_ROLE !== 'cdg' && NORMALIZED_ROLE !== 'back_office') {
          setTimeout(() => {
            if (!hot) return;
            _rowReadOnlyCache = {};
            const rows = hot.countRows ? hot.countRows() : 0;
            if (rows > 0) {
              const allRows = Array.from({ length: rows }, (_, i) => i);
              runRowsInChunks(allRows, 200, (slice) => updateRowReadOnlyState(slice));
            }
          }, 120);
        }
        
        // Forcer le rendu
        if (typeof hot.render === 'function') {
          hot.render();
        }
        
        // Notification discrète
        const statusEl = document.getElementById('status');
        if (statusEl) {
          statusEl.textContent = '🔄 Données actualisées';
          setTimeout(() => {
            if (statusEl.textContent === '🔄 Données actualisées') {
              statusEl.textContent = '';
            }
          }, 1500);
        }
      } catch (e) {
        console.warn('Erreur mise à jour Handsontable:', e);
      }
    }
  });

})();

// ============================================================
// ÉCOUTEUR POUR LA RECHERCHE DEPUIS LE DASHBOARD
// ============================================================
document.addEventListener('searchFromDashboard', function(event) {
  const searchValue = event.detail.searchValue;
  if (!searchValue) return;
  
  console.log('🔍 Recherche depuis Dashboard:', searchValue);
  window._dashboardSearchValue = searchValue;
  
  let hotInstance = null;
  if (typeof window.hot !== 'undefined' && window.hot !== null) {
    if (typeof window.hot.getSettings === 'function') {
      hotInstance = window.hot;
    } else if (window.hot.hot && typeof window.hot.hot.getSettings === 'function') {
      hotInstance = window.hot.hot;
    }
  }
  
  if (!hotInstance) {
    const container = document.getElementById('hot');
    if (container && container.hotInstance) {
      hotInstance = container.hotInstance;
    }
  }
  
  if (!hotInstance && typeof Handsontable !== 'undefined' && Handsontable.getInstances) {
    const instances = Handsontable.getInstances();
    if (instances && instances.length > 0) {
      hotInstance = instances[0];
    }
  }
  
  if (hotInstance && typeof hotInstance.getSettings === 'function') {
    try {
      const columns = hotInstance.getSettings().columns || [];
      const filterPlugin = hotInstance.getPlugin('filters');
      
      if (filterPlugin && typeof filterPlugin.addCondition === 'function') {
        let colIndex = -1;
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          if (col.data === 'designation_demandee' || col.data === 'designation_commandee') {
            colIndex = i;
            break;
          }
        }
        
        if (colIndex >= 0) {
          filterPlugin.clearConditions(colIndex);
          filterPlugin.addCondition(colIndex, 'contains', [searchValue]);
          filterPlugin.filter();
          if (typeof showToast === 'function') {
            showToast(`Filtre : "${searchValue}"`, 'success');
          }
          return;
        }
        
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          if (col.type === 'text' || col.data === 'designation_demandee' || col.data === 'designation_commandee') {
            filterPlugin.clearConditions(i);
            filterPlugin.addCondition(i, 'contains', [searchValue]);
            filterPlugin.filter();
            if (typeof showToast === 'function') {
              showToast(`Filtre : "${searchValue}"`, 'success');
            }
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Erreur Handsontable:', e);
    }
  }
  
  const tab = document.getElementById('tab-dossiers');
  if (tab) {
    const inputs = tab.querySelectorAll('input[type="text"], input[type="search"]');
    for (const input of inputs) {
      if (input.offsetParent !== null) {
        input.value = searchValue;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof showToast === 'function') {
          showToast(`Recherche : "${searchValue}"`, 'success');
        }
        return;
      }
    }
  }
  
  if (typeof window.applyFilters === 'function') {
    window._tempFilter = searchValue;
    window.applyFilters();
    if (typeof showToast === 'function') {
      showToast(`Recherche : "${searchValue}"`, 'success');
    }
  }
});

// ============================================================
// RÉINITIALISATION DU FILTRE LORS DU CHANGEMENT D'ONGLET
// ============================================================
(function setupFilterReset() {
  const originalSwitchTab = window.switchTab;
  if (originalSwitchTab) {
    window.switchTab = function(tab) {
      const currentActiveTab = document.querySelector('.tab-content.active');
      if (currentActiveTab && currentActiveTab.id === 'tab-dossiers' && tab !== 'dossiers') {
        resetAchatFilter();
      }
      originalSwitchTab(tab);
    };
  }
  
  document.querySelectorAll('.tab-link').forEach(link => {
    link.addEventListener('click', function() {
      const targetTab = this.dataset.tab;
      const currentActiveTab = document.querySelector('.tab-content.active');
      if (currentActiveTab && currentActiveTab.id === 'tab-dossiers' && targetTab !== 'dossiers') {
        setTimeout(resetAchatFilter, 100);
      }
    });
  });
})();

// ============================================================
// FONCTION POUR RÉINITIALISER LE FILTRE DANS LA PAGE ACHAT
// ============================================================
function resetAchatFilter() {
  window._dashboardSearchValue = '';
  
  let hotInstance = null;
  if (typeof window.hot !== 'undefined' && window.hot !== null) {
    if (typeof window.hot.getSettings === 'function') {
      hotInstance = window.hot;
    } else if (window.hot.hot && typeof window.hot.hot.getSettings === 'function') {
      hotInstance = window.hot.hot;
    }
  }
  
  if (!hotInstance) {
    const container = document.getElementById('hot');
    if (container && container.hotInstance) {
      hotInstance = container.hotInstance;
    }
  }
  
  if (hotInstance && typeof hotInstance.getSettings === 'function') {
    try {
      const filterPlugin = hotInstance.getPlugin('filters');
      if (filterPlugin && typeof filterPlugin.clearConditions === 'function' && typeof filterPlugin.filter === 'function') {
        const columns = hotInstance.getSettings().columns || [];
        for (let i = 0; i < columns.length; i++) {
          filterPlugin.clearConditions(i);
        }
        filterPlugin.filter();
      }
    } catch (e) {
      console.warn('Erreur réinitialisation Handsontable:', e);
    }
  }
  
  const tab = document.getElementById('tab-dossiers');
  if (tab) {
    const inputs = tab.querySelectorAll('input[type="text"], input[type="search"]');
    for (const input of inputs) {
      if (input.offsetParent !== null) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
}
// ============================================================
// INJECTION DES STYLES POUR FIXER LA HAUTEUR DES LIGNES
// ============================================================
(function injectFixedRowHeightStyle() {
  if (document.getElementById('fixed-row-height-style')) return;
  const style = document.createElement('style');
  style.id = 'fixed-row-height-style';
  style.textContent = `
    /* Forcer la hauteur des lignes */
    .handsontable td,
    .handsontable .htCore td {
      height: 30px !important;
      max-height: 30px !important;
      min-height: 30px !important;
      white-space: nowrap !important;
      text-overflow: ellipsis !important;
      overflow: hidden !important;
    }
    
    /* Cacher les indicateurs de resize */
    .handsontable .wtRowResizer {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
})();

window.resetAchatFilter = resetAchatFilter;