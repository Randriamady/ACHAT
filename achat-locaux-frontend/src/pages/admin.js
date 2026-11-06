// ============================================================
// PAGE ADMIN - Gestion des utilisateurs et import/export
// ============================================================

// Fonctions API existantes
async function fetchAPI(path, options = {}) {
  const token = localStorage.getItem('authToken');
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(apiUrl(path), { ...options, headers });
  if (response.status === 401) {
    if (typeof logout === 'function') {
      logout();
    }
    throw new Error('Session expirée. Veuillez vous reconnecter.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Erreur API');
  }
  return data;
}

// ============================================================
// GESTION DES UTILISATEURS (existant - non modifié)
// ============================================================

let adminSheetSettingsSnapshot = null;
let adminUsersSnapshot = null;

function formatRoleLabel(role) {
  const value = String(role || '').trim().toLowerCase();
  const labels = {
    admin: 'Admin',
    'back office': 'Back office',
    back_office: 'Back office',
    backoffice: 'Back office',
    achat: 'Achat',
    cdg: 'CDG',
    validateur: 'Validateur',
    utilisateur: 'Utilisateur',
    user: 'Utilisateur'
  };
  return labels[value] || (role ? String(role) : 'Utilisateur');
}

async function loadUsersAdmin() {
  try {
    const users = await fetchAPI('/api/users');
    const tbody = document.getElementById('users-table-body-admin');
    if (!tbody) {
      console.warn('Tableau users-table-body-admin non trouvé');
      return;
    }
    const userSnapshot = JSON.stringify(users);
    if (userSnapshot !== adminUsersSnapshot) {
      tbody.replaceChildren();
      users.forEach((u) => {
        const displayName = [u.name, u.full_name, u.identifier, u.username]
          .find(value => typeof value === 'string' && value.trim())?.trim() || '—';
        const row = tbody.insertRow();
        const identityCell = row.insertCell(0);
        identityCell.className = 'admin-user-identity-cell';
        const identity = document.createElement('div');
        identity.className = 'admin-user-identity';
        identity.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%';
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.style.background = u.avatar_color || '#ccc';
        avatar.textContent = displayName === '—' ? 'U' : displayName.substring(0, 2).toUpperCase();
        const name = document.createElement('div');
        name.className = 'admin-user-name';
        name.style.cssText = 'display:block;flex:1 1 auto;min-width:0;font-weight:500;color:#172033;white-space:normal;overflow-wrap:anywhere';
        name.textContent = displayName;
        name.title = displayName;
        identity.append(avatar, name);
        identityCell.appendChild(identity);

        const activeCell = row.insertCell(1);
        const activeBadge = document.createElement('span');
        activeBadge.className = `badge ${u.is_active ? 'badge-success' : 'badge-danger'}`;
        activeBadge.textContent = u.is_active ? 'Oui' : 'Non';
        activeCell.appendChild(activeBadge);

        const roleCell = row.insertCell(2);
        const roleBadge = document.createElement('span');
        roleBadge.className = 'badge badge-normal';
        roleBadge.textContent = formatRoleLabel(u.role);
        roleCell.appendChild(roleBadge);

        const actionsCell = row.insertCell(3);
        const toggleButton = document.createElement('button');
        toggleButton.className = 'btn btn-outline btn-sm';
        toggleButton.textContent = u.is_active ? 'Désactiver' : 'Activer';
        toggleButton.addEventListener('click', () => toggleUserActive(u.id));
        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn btn-outline btn-sm btn-danger';
        deleteButton.style.marginLeft = '8px';
        deleteButton.textContent = 'Supprimer';
        deleteButton.addEventListener('click', () => deleteUser(u.id));
        actionsCell.append(toggleButton, deleteButton);
      });
      adminUsersSnapshot = userSnapshot;
    }
    await loadAdminSheetSettings();
  } catch (err) {
    console.error('Erreur chargement utilisateurs admin:', err);
  }
}

function renderAdminSheetSettings(data) {
  const tbody = document.getElementById('admin-sheet-settings-body');
  if (!tbody) return;
  tbody.replaceChildren();

  const sheetOrder = [
    'colonne_gaelle',
    'colonne_jeannie',
    'colonne_raissa',
    'colonne_ando',
    'attente_comite',
    'valide_comite',
    'tous',
    'livre'
  ];
  data.sheets
    .filter((sheet) => sheet.key !== 'colonne')
    .sort((left, right) => {
      const leftOrder = sheetOrder.indexOf(left.key);
      const rightOrder = sheetOrder.indexOf(right.key);
      const normalizedLeft = leftOrder < 0 ? (left.ownerName ? 4 : 8) : leftOrder;
      const normalizedRight = rightOrder < 0 ? (right.ownerName ? 4 : 8) : rightOrder;
      return normalizedLeft - normalizedRight || left.name.localeCompare(right.name);
    })
    .forEach((sheet) => {
    const row = tbody.insertRow();
    row.dataset.sheetKey = sheet.key;
    row.dataset.savedState = JSON.stringify({
      name: sheet.name,
      enabled: sheet.enabled,
      visibleUserIds: sheet.visibleUserIds
    });
    row.dataset.dirty = 'false';
    const updateDirtyState = () => {
      const state = {
        name: row.querySelector('.admin-sheet-name')?.value.trim() || '',
        enabled: Boolean(row.querySelector('.admin-sheet-enabled')?.checked),
        visibleUserIds: row.querySelector('.admin-sheet-all-users')?.checked
          ? null
          : [...row.querySelectorAll('.admin-sheet-user:checked')]
            .map((input) => Number(input.value))
            .sort((a, b) => a - b)
      };
      const savedState = JSON.parse(row.dataset.savedState);
      if (Array.isArray(state.visibleUserIds)) state.visibleUserIds.sort((a, b) => a - b);
      if (Array.isArray(savedState.visibleUserIds)) savedState.visibleUserIds.sort((a, b) => a - b);
      row.dataset.dirty = JSON.stringify(state) === JSON.stringify(savedState) ? 'false' : 'true';
    };

    const labelCell = row.insertCell();
    const label = document.createElement('strong');
    label.textContent = sheet.name;
    labelCell.appendChild(label);

    const nameCell = row.insertCell();
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 80;
    nameInput.value = sheet.name;
    nameInput.className = 'admin-sheet-name';
    nameInput.setAttribute('aria-label', `Nom de la feuille ${sheet.name}`);
    nameInput.style.cssText = 'min-width:170px;width:100%;';
    nameInput.addEventListener('input', updateDirtyState);
    nameCell.appendChild(nameInput);

    const enabledCell = row.insertCell();
    const enabledLabel = document.createElement('label');
    enabledLabel.style.cssText = 'display:flex;align-items:center;gap:7px;white-space:nowrap;';
    const enabledInput = document.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.className = 'admin-sheet-enabled';
    enabledInput.checked = sheet.enabled;
    const enabledText = document.createElement('span');
    enabledText.textContent = sheet.enabled ? 'Activée' : 'Désactivée (masquée)';
    enabledInput.addEventListener('change', () => {
      enabledText.textContent = enabledInput.checked ? 'Activée' : 'Désactivée (masquée)';
      updateDirtyState();
    });
    enabledLabel.append(enabledInput, enabledText);
    enabledCell.appendChild(enabledLabel);

    const visibilityCell = row.insertCell();
    const visibilityControl = document.createElement('div');
    visibilityControl.style.cssText = 'display:inline-flex;position:relative;';
    const visibilityButton = document.createElement('button');
    visibilityButton.type = 'button';
    visibilityButton.className = 'btn btn-outline btn-sm admin-sheet-visibility-button';
    visibilityButton.setAttribute('aria-haspopup', 'true');
    visibilityButton.setAttribute('aria-expanded', 'false');
    visibilityButton.style.cssText = 'min-width:190px;text-align:left;justify-content:space-between;';
    const visibilityList = document.createElement('div');
    visibilityList.id = `admin-sheet-users-${sheet.key}`;
    visibilityList.setAttribute('popover', 'auto');
    visibilityList.style.cssText = 'position:fixed;inset:auto;margin:0;padding:10px;min-width:240px;max-width:min(360px,calc(100vw - 24px));max-height:260px;overflow:auto;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 12px 28px rgba(15,23,42,.18);background:#fff;color:#172033;z-index:10000;';
    visibilityButton.setAttribute('aria-controls', visibilityList.id);

    const selectedUserCount = () => visibilityList.querySelectorAll('.admin-sheet-user:checked').length;
    const updateVisibilityButton = () => {
      const selectedCount = selectedUserCount();
      visibilityButton.textContent = allUsersInput.checked
        ? `Tous les utilisateurs (${data.users.length}) ▾`
        : `${selectedCount} utilisateur(s) sélectionné(s) ▾`;
      visibilityButton.setAttribute('aria-expanded', String(visibilityList.matches(':popover-open')));
    };

    visibilityButton.addEventListener('click', () => {
      if (visibilityList.matches(':popover-open')) {
        visibilityList.hidePopover();
        updateVisibilityButton();
        return;
      }
      const bounds = visibilityButton.getBoundingClientRect();
      visibilityList.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - 372))}px`;
      visibilityList.style.top = `${Math.min(bounds.bottom + 4, window.innerHeight - 280)}px`;
      visibilityList.showPopover();
      updateVisibilityButton();
    });

    const allUsersLabel = document.createElement('label');
    allUsersLabel.style.cssText = 'display:flex;align-items:center;gap:6px;grid-column:1/-1;font-weight:600;';
    const allUsersInput = document.createElement('input');
    allUsersInput.type = 'checkbox';
    allUsersInput.className = 'admin-sheet-all-users';
    allUsersInput.checked = sheet.visibleUserIds === null;
    const allUsersText = document.createElement('span');
    allUsersText.textContent = 'Tous les utilisateurs';
    allUsersLabel.append(allUsersInput, allUsersText);
    visibilityList.appendChild(allUsersLabel);

    data.users.forEach((user) => {
      const userLabel = document.createElement('label');
      userLabel.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const userInput = document.createElement('input');
      userInput.type = 'checkbox';
      userInput.className = 'admin-sheet-user';
      userInput.value = String(user.id);
      userInput.checked = sheet.visibleUserIds === null ||
        (Array.isArray(sheet.visibleUserIds) && sheet.visibleUserIds.includes(Number(user.id)));
      userInput.disabled = allUsersInput.checked;
      userInput.addEventListener('change', () => {
        allUsersInput.checked = false;
        visibilityList.querySelectorAll('.admin-sheet-user').forEach((input) => {
          input.disabled = false;
        });
        updateVisibilityButton();
        updateDirtyState();
      });
      const userText = document.createElement('span');
      userText.textContent = `${user.name}${user.isActive ? '' : ' (désactivé)'}`;
      userLabel.append(userInput, userText);
      visibilityList.appendChild(userLabel);
    });

    allUsersInput.addEventListener('change', () => {
      visibilityList.querySelectorAll('.admin-sheet-user').forEach((input) => {
        input.disabled = allUsersInput.checked;
        if (allUsersInput.checked) input.checked = true;
      });
      updateVisibilityButton();
      updateDirtyState();
    });
    updateVisibilityButton();
    visibilityCell.append(visibilityControl, visibilityList);
    visibilityControl.appendChild(visibilityButton);
    visibilityList.addEventListener('toggle', updateVisibilityButton);

    const actionCell = row.insertCell();
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn-outline btn-sm';
    saveButton.textContent = 'Enregistrer';
    saveButton.addEventListener('click', () => saveAdminSheetSettings(row, saveButton));
    actionCell.appendChild(saveButton);
  });
  adminSheetSettingsSnapshot = JSON.stringify(data);
}

function hasPendingAdminSheetInteraction() {
  const tbody = document.getElementById('admin-sheet-settings-body');
  if (!tbody) return false;
  return Boolean(
    tbody.querySelector('[data-dirty="true"]') ||
    tbody.querySelector('.admin-sheet-name:focus, .admin-sheet-enabled:focus, .admin-sheet-user:focus, .admin-sheet-all-users:focus') ||
    tbody.querySelector('[popover]:popover-open')
  );
}

async function loadAdminSheetSettings(showError = true) {
  try {
    const data = await fetchAPI('/api/sheets/admin', { cache: 'no-store' });
    if (!data.ok || !Array.isArray(data.sheets) || !Array.isArray(data.users)) {
      throw new Error('Réponse invalide lors du chargement des feuilles.');
    }
    if (!hasPendingAdminSheetInteraction() && JSON.stringify(data) !== adminSheetSettingsSnapshot) {
      renderAdminSheetSettings(data);
    }
    return true;
  } catch (err) {
    console.error('Erreur chargement des feuilles admin:', err);
    if (showError && typeof showToast === 'function') {
      showToast(err.message || 'Impossible de charger les feuilles Achat.', true);
    }
    return false;
  }
}

async function saveAdminSheetSettings(row, button) {
  const key = row.dataset.sheetKey;
  const name = row.querySelector('.admin-sheet-name')?.value.trim() || '';
  const enabled = Boolean(row.querySelector('.admin-sheet-enabled')?.checked);
  const allUsers = Boolean(row.querySelector('.admin-sheet-all-users')?.checked);
  const visibleUserIds = allUsers
    ? null
    : [...row.querySelectorAll('.admin-sheet-user:checked')].map((input) => Number(input.value));
  const savedState = {
    name,
    enabled,
    visibleUserIds: visibleUserIds === null ? null : [...visibleUserIds].sort((a, b) => a - b)
  };

  button.disabled = true;
  try {
    await fetchAPI(`/api/sheets/admin/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, enabled, visibleUserIds })
    });
    row.dataset.savedState = JSON.stringify(savedState);
    row.dataset.dirty = 'false';
    const refreshed = await loadAdminSheetSettings(false);
    window.dispatchEvent(new Event('achat-sheet-config-updated'));
    if (typeof showToast === 'function') {
      showToast(refreshed
        ? 'Paramètres de la feuille enregistrés.'
        : 'Paramètres enregistrés, mais la liste n’a pas pu être actualisée.', !refreshed);
    }
  } catch (err) {
    console.error('Erreur mise à jour feuille:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Impossible d’enregistrer la feuille.', true);
    }
  } finally {
    button.disabled = false;
  }
}

async function createOwnerSheet() {
  const input = document.getElementById('adminNewOwnerName');
  const button = document.getElementById('createOwnerSheetBtn');
  const ownerName = input?.value.trim() || '';
  if (!ownerName) {
    if (typeof showToast === 'function') showToast('Saisissez le nom de l’acheteur.', true);
    input?.focus();
    return;
  }

  if (button) button.disabled = true;
  try {
    await fetchAPI('/api/sheets/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName })
    });
    if (input) input.value = '';
    const refreshed = await loadAdminSheetSettings();
    window.dispatchEvent(new Event('achat-sheet-config-updated'));
    if (typeof showToast === 'function') {
      showToast(refreshed
        ? 'Feuille acheteur créée et visible pour tous les utilisateurs.'
        : 'Feuille créée, mais la liste n’a pas pu être actualisée.', !refreshed);
    }
  } catch (err) {
    console.error('Erreur création feuille acheteur:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Impossible de créer la feuille acheteur.', true);
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function toggleUserActive(userId) {
  try {
    const data = await fetchAPI(`/api/users/${userId}/toggle-active`, { method: 'PATCH' });
    if (data.ok) {
      await loadUsersAdmin();
      if (typeof showToast === 'function') {
        showToast('Statut mis à jour', 'success');
      }
    }
  } catch (err) {
    console.error('Erreur toggle user:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Impossible de modifier le statut', 'error');
    }
  }
}

async function deleteUser(userId) {
  if (!confirm('Supprimer cet utilisateur définitivement ?')) return;
  try {
    const data = await fetchAPI(`/api/users/${userId}`, { method: 'DELETE' });
    if (data.ok) {
      await loadUsersAdmin();
      if (typeof showToast === 'function') {
        showToast('Utilisateur supprimé', 'success');
      }
    }
  } catch (err) {
    console.error('Erreur suppression utilisateur:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Impossible de supprimer l’utilisateur', 'error');
    }
  }
}

async function handleBudgetImport(files) {
  if (!files || !files.length) return;
  const file = files[0];
  if (typeof showToast === 'function') {
    showToast(`Import du fichier ${file.name} en cours...`, 'success');
  }
  try {
    const text = await file.text();
    if (typeof showToast === 'function') {
      showToast(`Fichier ${file.name} prêt à l’import.`, 'success');
    }
    console.log('Budget import preview', text.slice(0, 200));
  } catch (err) {
    console.error('Erreur import budget:', err);
    if (typeof showToast === 'function') {
      showToast('Impossible de lire le fichier', 'error');
    }
  }
}

function toggleAdminCreateSection(user) {
  const section = document.getElementById('adminCreateSection');
  if (!section) return;
  const isAdmin = user?.role === 'admin';
  section.style.display = isAdmin ? 'block' : 'none';
}

async function createAdminAccount() {
  const fullName = document.getElementById('adminCreateFullName')?.value.trim() || '';
  const identifier = document.getElementById('adminCreateIdentifier')?.value.trim().toLowerCase() || '';
  const password = document.getElementById('adminCreatePassword')?.value || '';
  const role = document.getElementById('adminCreateRole')?.value || 'achat';

  if (!fullName || !identifier || !password) {
    if (typeof showToast === 'function') {
      showToast('Remplissez tous les champs pour créer le compte', 'error');
    }
    return;
  }

  try {
    const data = await fetchAPI('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, name: fullName, password, role })
    });

    if (data.ok) {
      document.getElementById('adminCreateFullName').value = '';
      document.getElementById('adminCreateIdentifier').value = '';
      document.getElementById('adminCreatePassword').value = '';
      document.getElementById('adminCreateRole').value = 'achat';
      await loadUsersAdmin();
      if (typeof showToast === 'function') {
        showToast('Compte créé', 'success');
      }
    }
  } catch (err) {
    console.error('Erreur création admin:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Impossible de créer le compte admin', 'error');
    }
  }
}

// ============================================================
// NOUVELLES FONCTIONS : IMPORT / EXPORT EXCEL
// ============================================================

/**
 * Importe des données depuis un fichier Excel vers la base de données
 * @param {FileList} files - Liste des fichiers sélectionnés
 */
async function importAchatsFromExcel(files) {
  // Vérification des fichiers
  if (!files || !files.length) {
    if (typeof showToast === 'function') {
      showToast('Veuillez sélectionner un fichier Excel', 'error');
    }
    return;
  }
  
  const file = files[0];
  const validExtensions = ['.xlsx'];
  const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  const maxExcelFileSize = 25 * 1024 * 1024;
  
  if (!validExtensions.includes(fileExt)) {
    if (typeof showToast === 'function') {
      showToast('Veuillez sélectionner un fichier Excel (.xlsx)', 'error');
    }
    return;
  }

  if (file.size > maxExcelFileSize) {
    if (typeof showToast === 'function') {
      showToast('Le fichier Excel ne doit pas dépasser 25 Mo.', 'error');
    }
    return;
  }
  
  try {
    // Vérifier que XLSX est disponible
    if (typeof XLSX === 'undefined') {
      if (typeof showToast === 'function') {
        showToast('La bibliothèque XLSX n\'est pas chargée. Veuillez recharger la page.', 'error');
      }
      console.error('XLSX library not loaded');
      return;
    }
    
    if (typeof showToast === 'function') {
      showToast(`Lecture du fichier ${file.name}...`, 'info');
    }
    
    // Lire le fichier Excel
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellHTML: false,
      cellFormula: false,
      bookVBA: false,
      bookFiles: false,
      bookDeps: false,
      sheetRows: 50000,
      WTF: false
    });
    
    // Prendre la première feuille (REPORTING_ACHAT_LOCAL)
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    if (!jsonData || jsonData.length === 0) {
      if (typeof showToast === 'function') {
        showToast('Le fichier ne contient pas de données', 'error');
      }
      return;
    }
    
    // Filtrer les lignes vides
    const filteredData = jsonData.filter(row => {
      // Vérifier si la ligne a au moins une donnée significative
      const hasData = Object.values(row).some(value => 
        value !== undefined && 
        value !== null && 
        value !== '' && 
        value !== 'N° DA' // Ignorer les lignes d'en-tête
      );
      return hasData;
    });
    
    if (filteredData.length === 0) {
      if (typeof showToast === 'function') {
        showToast('Aucune donnée valide trouvée dans le fichier', 'error');
      }
      return;
    }
    
    // Confirmer l'import
    if (!confirm(`Importer ${filteredData.length} ligne(s) depuis "${file.name}" ?\n\n⚠️ Les données existantes ne seront pas écrasées.`)) {
      return;
    }
    
    if (typeof showToast === 'function') {
      showToast(`Importation de ${filteredData.length} ligne(s) en cours...`, 'info');
    }
    
    // Envoyer les données au serveur
    const result = await fetchAPI('/api/admin/import-achats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: filteredData })
    });
    
    if (result.success) {
      const imported = Number(result.inserted) || 0;
      const errors = Array.isArray(result.errors) ? result.errors : [];
      if (errors.length > 0) {
        console.error('Erreurs d\'import:\n' + errors.join('\n'));
        if (typeof showToast === 'function') {
          showToast(`${imported} ligne(s) importée(s), ${errors.length} erreur(s). Consultez la console pour le détail.`, true);
        }
      } else if (typeof showToast === 'function') {
        showToast(`${imported} ligne(s) importée(s) avec succès.`, false);
      }
      
      // Rafraîchir les données dans l'onglet Dossiers
      if (typeof window.loadDataFromAPI === 'function') {
        setTimeout(async () => {
          try {
            await window.loadDataFromAPI();
            if (window.ALL_DATA && window.ALL_DATA.length > 0 && typeof window.bootstrapDossiersTable === 'function') {
              window.bootstrapDossiersTable(window.FILTERED);
            }
          } catch (e) {
            console.warn('Rafraîchissement des données après import:', e);
          }
        }, 500);
      }
    } else {
      if (typeof showToast === 'function') {
        showToast('Erreur lors de l\'import: ' + (result.error || 'Inconnue'), 'error');
      }
    }
    
  } catch (err) {
    console.error('Erreur import Excel:', err);
    if (typeof showToast === 'function') {
      showToast('Erreur lors de l\'import: ' + err.message, 'error');
    }
  }
}

function loadImportFolderPath() {
  const input = document.getElementById('importFolderPath');
  if (!input) return;
  input.value = localStorage.getItem('importFolderName') || '';
}

async function refreshAchatsFromFolder(files) {
  if (!files || !files.length) {
    document.getElementById('importFolderInput')?.click();
    return;
  }

  const excelFiles = Array.from(files).filter((file) => /\.(xlsx|xls)$/i.test(file.name));
  if (!excelFiles.length) {
    if (typeof showToast === 'function') showToast('Aucun fichier Excel trouvé dans ce dossier.', 'error');
    return;
  }

  const folderName = excelFiles[0].webkitRelativePath?.split('/')[0] || excelFiles[0].name;
  localStorage.setItem('importFolderName', folderName);
  loadImportFolderPath();

  try {
    if (typeof showLoading === 'function') showLoading();
    if (typeof showToast === 'function') showToast(`Lecture de ${excelFiles.length} fichier(s) en cours...`, 'info');

    const rows = [];
    for (const file of excelFiles) {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) continue;
      rows.push(...XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null }));
    }

    if (!rows.length) {
      throw new Error('Les fichiers Excel sélectionnés ne contiennent aucune donnée.');
    }

    if (!confirm(`Remplacer les données par ${rows.length} ligne(s) provenant de ${excelFiles.length} fichier(s) ?`)) return;

    let inserted = 0;
    const batchSize = 100;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const result = await fetchAPI('/api/admin/import-achats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: batch, replace: start === 0 })
      });
      inserted += result.inserted || 0;
      if (typeof showToast === 'function') {
        showToast(`${Math.min(start + batch.length, rows.length)}/${rows.length} ligne(s) traitée(s)...`, 'info');
      }
    }

    if (typeof window.clearAppDataCache === 'function') window.clearAppDataCache();
    if (typeof window.loadDataFromAPI === 'function') await window.loadDataFromAPI();
    if (typeof window.render === 'function') window.render();
    if (typeof showToast === 'function') {
      showToast(`${inserted} ligne(s) importée(s) depuis ${excelFiles.length} fichier(s).`, 'success');
      console.info('Fichiers Excel importés:', excelFiles.map((file) => file.name));
    }
  } catch (err) {
    console.error('Erreur actualisation depuis le dossier:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Actualisation impossible.', 'error');
  } finally {
    if (typeof hideLoading === 'function') hideLoading();
  }
}

async function refreshConfiguredData() {
  window.location.reload();
}

function getExportDateRange() {
  const startInput = document.getElementById('exportStartDate');
  const endInput = document.getElementById('exportEndDate');
  const startDate = startInput ? startInput.value : '';
  const endDate = endInput ? endInput.value : '';

  if (startDate && endDate && startDate > endDate) {
    if (typeof showToast === 'function') {
      showToast('La date de début doit être antérieure à la date de fin.', 'error');
    }
    return null;
  }

  return { startDate, endDate };
}

const ACHATS_TABLE_EXPORT_COLUMNS = [
  ['numero_da', 'N° DA'],
  ['date', 'Date'],
  ['date_reception_physique', 'Date de reception physique'],
  ['filiale', 'Filiale'],
  ['departement_demandeur', 'Dpt. Demandeur'],
  ['designation_demandee', 'Désignation Demandée'],
  ['designation_commandee', 'Désignation Commandée'],
  ['code_budget', 'Code Budget'],
  ['montant_budget', 'Montant Budget'],
  ['ecart_budget', 'Écart Budget'],
  ['statut_budget', 'Statut Budget'],
  ['mode_consultation', 'Mode de Consultation'],
  ['fournisseur_retenu', 'Fournisseur Retenu'],
  ['fournisseurs_consultes', 'Fournisseurs Consultés'],
  ['prix_reference', 'Prix de Référence'],
  ['prix_unitaire', 'Prix Unitaire'],
  ['ecart_pourcentage', 'Écart (%)'],
  ['quantite', 'Qté'],
  ['unite', 'Unité'],
  ['montant_ht', 'Montant HT'],
  ['gain_achat', 'GAIN Achat'],
  ['devise', 'Devise'],
  ['type_paiement', 'Type de Paiement'],
  ['delai_paiement', 'Délai Paiement'],
  ['statut_paiement', 'Statut Paiement'],
  ['date_envoi_consultation', 'Date Envoi Consultation'],
  ['date_envoi_tco', 'Date Envoi TCO'],
  ['date_valid_filiale', 'Date Valid. Filiale'],
  ['date_valid_comite', 'Date Valid. Comité'],
  ['pv_numero', 'PV N°'],
  ['num_bc', 'N° BC'],
  ['date_envoi_bc', 'Date Envoi BC'],
  ['immatriculation_vehicule', 'Immatriculation du véhicule'],
  ['utilisateur_vehicule', 'Utilisateur du véhicule'],
  ['date_envoi_cdg', 'Date Envoi CDG'],
  ['date_paiement', 'Date de Paiement'],
  ['date_prevue_livraison', 'Date Prévu Livraison'],
  ['date_reception_facture', 'Date Reception Facture'],
  ['numero_facture', 'N° Facture'],
  ['bl', 'BL'],
  ['be', 'BE'],
  ['date_transmission', 'Date Transmission'],
  ['statut', 'Statut'],
  ['categorie_achat', 'Catégorie Achat'],
  ['acheteur', 'Acheteur'],
  ['obs', 'OBS'],
  ['action_requise', 'Action Requise'],
  ['priorite', 'Priorité'],
  ['nb_bc', 'NB BC']
];

/**
 * Exporte les données de la base vers un fichier Excel
 */
async function exportAchatsToExcel() {
  try {
    // Vérifier que XLSX est disponible
    if (typeof XLSX === 'undefined') {
      if (typeof showToast === 'function') {
        showToast('La bibliothèque XLSX n\'est pas chargée. Veuillez recharger la page.', 'error');
      }
      console.error('XLSX library not loaded');
      return;
    }

    const dateRange = getExportDateRange();
    if (!dateRange) {
      return;
    }

    if (typeof showToast === 'function') {
      showToast('Exportation en cours...', 'info');
    }

    const query = new URLSearchParams();
    if (dateRange.startDate) query.set('startDate', dateRange.startDate);
    if (dateRange.endDate) query.set('endDate', dateRange.endDate);

    const url = `/api/admin/export-achats${query.toString() ? `?${query.toString()}` : ''}`;
    const result = await fetchAPI(url);

    if (result.success && result.data && result.data.length > 0) {
      // Créer un workbook Excel
      const wb = XLSX.utils.book_new();
      const exportRows = result.data.map(row => {
        const orderedRow = {};
        ACHATS_TABLE_EXPORT_COLUMNS.forEach(([key, title]) => {
          orderedRow[title] = row[title] ?? row[key] ?? '';
        });
        return orderedRow;
      });
      const ws = XLSX.utils.json_to_sheet(exportRows, {
        header: ACHATS_TABLE_EXPORT_COLUMNS.map(([, title]) => title)
      });
      
      // Ajuster la largeur des colonnes
      const maxWidth = 20;
      const colWidths = ACHATS_TABLE_EXPORT_COLUMNS.map(([, title]) => ({
        wch: Math.min(Math.max(title.length * 1.5, 12), maxWidth)
      }));
      ws['!cols'] = colWidths;
      
      XLSX.utils.book_append_sheet(wb, ws, 'Achats');
      
      // Générer le fichier
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      
      // Créer un blob et télécharger
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      link.download = `Export_Achats_${dateStr}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      if (typeof showToast === 'function') {
        showToast(`${result.count} ligne(s) exportée(s) avec succès`, 'success');
      }
    } else {
      if (typeof showToast === 'function') {
        showToast('Aucune donnée à exporter', 'warning');
      }
    }
    
  } catch (err) {
    console.error('Erreur export Excel:', err);
    if (typeof showToast === 'function') {
      showToast('Erreur lors de l\'export: ' + err.message, 'error');
    }
  }
}

async function deleteAllAchats() {
  const confirmed = confirm('Attention : cette action supprimera toutes les donnees d achats de la base. Continuer ?');
  if (!confirmed) return;

  const secondConfirmation = prompt('Pour confirmer, tapez SUPPRIMER');
  if (secondConfirmation !== 'SUPPRIMER') {
    if (typeof showToast === 'function') showToast('Suppression annulee.', 'info');
    return;
  }

  try {
    const result = await fetchAPI('/api/admin/achats', { method: 'DELETE' });
    if (typeof window.clearAppDataCache === 'function') window.clearAppDataCache();
    if (typeof window.loadDataFromAPI === 'function') await window.loadDataFromAPI();
    if (typeof window.render === 'function') window.render();
  } catch (err) {
    console.error('Erreur suppression donnees achats:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Suppression impossible.', 'error');
  }
}

async function deleteAchatsByPv() {
  const input = document.getElementById('deletePvNumber');
  const pvNumero = input?.value.trim() || '';
  if (!pvNumero) {
    if (typeof showToast === 'function') showToast('Saisissez un numero de PV.', 'error');
    return;
  }

  if (!confirm(`Supprimer toutes les donnees associees au PV "${pvNumero}" ?`)) return;

  try {
    const result = await fetchAPI('/api/admin/achats/by-pv', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pvNumero })
    });
    input.value = '';
    if (typeof window.clearAppDataCache === 'function') window.clearAppDataCache();
    if (typeof window.loadDataFromAPI === 'function') await window.loadDataFromAPI();
    if (typeof window.render === 'function') window.render();
    if (typeof showToast === 'function') {
      showToast(`${result.deleted || 0} ligne(s) supprimee(s) pour le PV ${result.pvNumero}.`, 'success');
    }
  } catch (err) {
    console.error('Erreur suppression par numero PV:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Suppression impossible.', 'error');
  }
}

function deleteAdminData() {
  const mode = document.getElementById('deleteDataMode')?.value || 'pv';
  if (mode === 'all') {
    return deleteAllAchats();
  }
  return deleteAchatsByPv();
}

function toggleDeletePvField() {
  const mode = document.getElementById('deleteDataMode')?.value || 'pv';
  const input = document.getElementById('deletePvNumber');
  if (!input) return;
  input.disabled = mode === 'all';
  if (mode === 'all') input.value = '';
}

document.addEventListener('DOMContentLoaded', toggleDeletePvField);

// ============================================================
// EXPOSITION DES FONCTIONS GLOBALEMENT (existant + nouvelles)
// ============================================================

// Fonctions existantes
window.loadUsersAdmin = loadUsersAdmin;
window.loadAdminSheetSettings = loadAdminSheetSettings;
window.toggleUserActive = toggleUserActive;
window.deleteUser = deleteUser;
window.fetchAPI = fetchAPI;
window.handleBudgetImport = handleBudgetImport;
window.createAdminAccount = createAdminAccount;
window.toggleAdminCreateSection = toggleAdminCreateSection;

// Nouvelles fonctions
window.importAchatsFromExcel = importAchatsFromExcel;
window.loadImportFolderPath = loadImportFolderPath;
window.refreshAchatsFromFolder = refreshAchatsFromFolder;
window.refreshConfiguredData = refreshConfiguredData;
window.exportAchatsToExcel = exportAchatsToExcel;

// ============================================================
// INITIALISATION (existant - non modifié)
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  loadImportFolderPath();

  // Bouton de création admin
  const createAdminBtn = document.getElementById('createAdminBtn');
  if (createAdminBtn) {
    createAdminBtn.addEventListener('click', createAdminAccount);
  }

  const createOwnerSheetBtn = document.getElementById('createOwnerSheetBtn');
  if (createOwnerSheetBtn) {
    createOwnerSheetBtn.addEventListener('click', createOwnerSheet);
  }
  
  // NOTE: Le chargement des utilisateurs est géré par le script principal
  // qui appelle loadUsersAdmin() après l'authentification
});