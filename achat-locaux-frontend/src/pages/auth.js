(function() {
  const authBox = document.getElementById('authBox');
  const authForm = document.getElementById('authForm');
  const registerForm = document.getElementById('registerForm');
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  const authMessage = document.getElementById('authMessage');
  const appShell = document.getElementById('appShell');
  const navUserName = document.getElementById('navUserName');

  const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
  const HIDDEN_TAB_TIMEOUT_MS = 5 * 60 * 1000;
  let inactivityTimer = null;
  let hiddenTabTimer = null;
  let inactivityListenersAttached = false;
  let sessionCheckPromise = null;

  function clearInactivityAutoLogout() {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  function clearHiddenTabLogout() {
    if (hiddenTabTimer) {
      clearTimeout(hiddenTabTimer);
      hiddenTabTimer = null;
    }
  }

  function handleTabVisibilityChange() {
    const token = localStorage.getItem('authToken');
    if (!token) {
      clearHiddenTabLogout();
      return;
    }

    if (document.visibilityState === 'hidden') {
      if (typeof window.stopSilentBackgroundRefresh === 'function') {
        window.stopSilentBackgroundRefresh();
      }
      clearHiddenTabLogout();
      hiddenTabTimer = setTimeout(() => {
        if (document.visibilityState === 'hidden' && typeof window.logout === 'function') {
          window.logout();
        }
      }, HIDDEN_TAB_TIMEOUT_MS);
      return;
    }

    clearHiddenTabLogout();
    resetInactivityAutoLogout();
    if (typeof window.startSilentBackgroundRefresh === 'function') {
      window.startSilentBackgroundRefresh();
    }
  }

  function resetInactivityAutoLogout() {
    const token = localStorage.getItem('authToken');
    if (!token) {
      clearInactivityAutoLogout();
      return;
    }

    clearInactivityAutoLogout();
    inactivityTimer = setTimeout(() => {
      if (typeof window.logout === 'function') {
        window.logout();
      }
    }, INACTIVITY_TIMEOUT_MS);
  }

  function attachInactivityAutoLogout() {
    if (inactivityListenersAttached) return;

    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'touchmove'];
    activityEvents.forEach((eventName) => {
      document.addEventListener(eventName, resetInactivityAutoLogout, { passive: true });
    });

    document.addEventListener('visibilitychange', handleTabVisibilityChange);

    window.addEventListener('focus', resetInactivityAutoLogout);
    inactivityListenersAttached = true;
    resetInactivityAutoLogout();
    handleTabVisibilityChange();
  }

  window.startInactivityAutoLogout = function() {
    if (!localStorage.getItem('authToken')) {
      clearInactivityAutoLogout();
      return;
    }
    attachInactivityAutoLogout();
  };

  window.stopInactivityAutoLogout = function() {
    clearInactivityAutoLogout();
    clearHiddenTabLogout();
  };

  async function refreshAppAfterAuthChange() {
    try {
      const token = localStorage.getItem('authToken');

      if (!token) {
        // Pas de session : on nettoie l'affichage et on coupe tout polling en cours.
        clearInactivityAutoLogout();
        updateUserLabel(null);
        setAuthenticated(false);
        if (typeof window.stopSilentBackgroundRefresh === 'function') {
          window.stopSilentBackgroundRefresh();
        }
        return;
      }

      if (typeof window.clearAppDataCache === 'function') {
        window.clearAppDataCache();
      }
      try {
        sessionStorage.clear();
      } catch (err) {
        console.warn('Impossible de nettoyer sessionStorage', err);
      }

      // Rechargement des données sans loader bloquant.
      if (typeof window.loadDataFromAPI === 'function') {
        await window.loadDataFromAPI({ silent: true, force: true }).catch(() => {});
      }

      if (typeof window.render === 'function') {
        window.render();
      }

      if (typeof window.switchTab === 'function') {
        const currentTab = localStorage.getItem('achatsActiveTab') || 'dashboard';
        window.switchTab(currentTab);
      }

      if (typeof window.loadUsersAdmin === 'function') {
        window.loadUsersAdmin();
      }
      if (typeof window.loadActivityByUser === 'function') {
        window.loadActivityByUser();
      }
      if (typeof window.toggleAdminCreateSection === 'function') {
        const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
        window.toggleAdminCreateSection(currentUser);
      }
      if (typeof window.loadImportFolderPath === 'function') {
        window.loadImportFolderPath();
      }

      if (typeof window.startSilentBackgroundRefresh === 'function') {
        window.startSilentBackgroundRefresh();
      }
    } catch (err) {
      console.warn('Impossible de rafraîchir l’application après changement de session', err);
    }
  }

  function setAuthenticated(isAuth) {
    if (appShell) {
      appShell.style.display = isAuth ? 'block' : 'none';
    }
    if (authBox) {
      authBox.style.display = isAuth ? 'none' : 'flex';
    }
  }

  function getUserLabel(user) {
    if (!user) return 'Utilisateur';
    return user.name || user.full_name || user.identifier || user.username || 'Utilisateur';
  }

  const connectedUsersButton = document.getElementById('connectedUsersButton');
  let onlineUsersPopup = null;
  let onlineUsersList = [];
  let cachedOnlineUsers = [];
  let onlineUsersRequest = null;
  let onlineUsersLastFetchAt = 0;
  const ONLINE_USERS_MIN_INTERVAL_MS = 5000;

  function ensureOnlineUsersPopup() {
    if (onlineUsersPopup) return onlineUsersPopup;
    if (!connectedUsersButton) return null;

    onlineUsersPopup = document.createElement('div');
    onlineUsersPopup.className = 'online-users-popup';
    onlineUsersPopup.style.display = 'none';
    onlineUsersPopup.setAttribute('role', 'dialog');
    onlineUsersPopup.setAttribute('aria-label', 'Utilisateurs en ligne');
    connectedUsersButton.parentElement?.appendChild(onlineUsersPopup);
    return onlineUsersPopup;
  }

  function renderOnlineUsersPopup() {
    const popup = ensureOnlineUsersPopup();
    if (!popup) return;
    if (!onlineUsersList.length) {
      popup.style.display = 'none';
      connectedUsersButton.setAttribute('aria-expanded', 'false');
      return;
    }

    const itemsHtml = onlineUsersList.map(name => `<div class="online-users-item">${name}</div>`).join('');
    popup.innerHTML = `
      <div class="online-users-popup-header">En ligne (${onlineUsersList.length})</div>
      <div class="online-users-list">${itemsHtml}</div>
    `;
    popup.style.display = 'block';
    connectedUsersButton.setAttribute('aria-expanded', 'true');
  }

  function hideOnlineUsersPopup() {
    if (!onlineUsersPopup) return;
    onlineUsersPopup.style.display = 'none';
    connectedUsersButton.setAttribute('aria-expanded', 'false');
  }

  function updateConnectedUsersNames(users) {
    if (!connectedUsersButton) return;
    cachedOnlineUsers = Array.isArray(users) ? users : [];
    if (!cachedOnlineUsers.length) {
      connectedUsersButton.style.display = 'none';
      connectedUsersButton.textContent = 'En ligne';
      connectedUsersButton.title = '';
      connectedUsersButton.disabled = true;
      onlineUsersList = [];
      hideOnlineUsersPopup();
      return;
    }

    const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
    const currentName = currentUser?.name || currentUser?.full_name || currentUser?.identifier || currentUser?.username || null;

    const uniqueUsers = [];
    const seen = new Set();

    cachedOnlineUsers.forEach((u) => {
      const name = u.name || u.identifier || u.username || 'Utilisateur';
      const userKey = u.id !== undefined && u.id !== null
        ? String(u.id)
        : `name:${name}`;
      if (u.id !== undefined && u.id !== null && currentUser?.id !== undefined && String(u.id) === String(currentUser.id)) {
        return;
      }
      if (!u.id && name === currentName) {
        return;
      }
      if (!seen.has(userKey)) {
        seen.add(userKey);
        uniqueUsers.push(name);
      }
    });

    if (uniqueUsers.length === 0) {
      connectedUsersButton.style.display = 'none';
      connectedUsersButton.textContent = 'En ligne';
      connectedUsersButton.title = '';
      connectedUsersButton.disabled = true;
      onlineUsersList = [];
      hideOnlineUsersPopup();
      return;
    }

    connectedUsersButton.style.display = 'inline-flex';
    connectedUsersButton.textContent = `En ligne : ${uniqueUsers.length}`;
    connectedUsersButton.title = '';
    connectedUsersButton.disabled = false;
    onlineUsersList = uniqueUsers;
    hideOnlineUsersPopup();
  }

  function updateUserLabel(user) {
    if (!navUserName) return;
    const name = user?.name || user?.full_name || user?.identifier || user?.username || 'Connecté';
    const avatarUrl = user?.avatar_url || '';

    navUserName.innerHTML = '';
    navUserName.classList.remove('has-avatar');
    if (avatarUrl) {
      const avatarEl = document.createElement('span');
      avatarEl.className = 'nav-user-avatar';
      avatarEl.style.backgroundImage = `url('${avatarUrl.replace(/'/g, "\\'")}')`;
      navUserName.appendChild(avatarEl);
    }

    const textEl = document.createElement('span');
    textEl.textContent = name;
    navUserName.appendChild(textEl);

    if (avatarUrl) {
      navUserName.classList.add('has-avatar');
    }
  }

  async function fetchOnlineUsers() {
    if (onlineUsersRequest) return onlineUsersRequest;

    const token = localStorage.getItem('authToken');
    if (!token) {
      updateConnectedUsersNames([]);
      return;
    }

    if (Date.now() - onlineUsersLastFetchAt < ONLINE_USERS_MIN_INTERVAL_MS) return;
    onlineUsersLastFetchAt = Date.now();

    onlineUsersRequest = (async () => {
      try {
        const response = await fetch(apiUrl('/api/auth/online'), {
        headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok && data.ok && localStorage.getItem('authToken') === token) {
          updateConnectedUsersNames(data.users || []);
        } else if (!response.ok) {
          updateConnectedUsersNames([]);
        }
      } catch (err) {
        updateConnectedUsersNames([]);
      } finally {
        onlineUsersRequest = null;
      }
    })();

    return onlineUsersRequest;
  }

  function emitAuthPresenceSignal(action, userOverride = null) {
    try {
      const currentUser = userOverride || JSON.parse(localStorage.getItem('user') || 'null');
      localStorage.setItem('authPresenceSignal', JSON.stringify({
        action,
        userId: currentUser?.id || null,
        ts: Date.now()
      }));
    } catch (err) {
      console.warn('Impossible d’émettre le signal de présence', err);
    }
  }

  function persistAuthSession(token, user) {
    if (token) {
      localStorage.setItem('authToken', token);
    } else {
      localStorage.removeItem('authToken');
    }
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
    localStorage.setItem('authSessionVersion', String(Date.now()));
    emitAuthPresenceSignal(token ? 'login' : 'logout', user || null);
  }

  function clearAuthSession() {
    const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    localStorage.removeItem('authSessionVersion');
    localStorage.removeItem('achatsFilterState');
    localStorage.removeItem('achatsActiveTab');
    localStorage.removeItem('achatsAuditEntries');
    emitAuthPresenceSignal('logout', currentUser);
    if (typeof window.clearAppDataCache === 'function') {
      window.clearAppDataCache();
    }
  }

  function setAuthMessage(message, type = 'info') {
    if (!authMessage) return;
    authMessage.textContent = message;
    authMessage.className = `auth-message${type && type !== 'info' ? ` ${type}` : ''}`;
  }

  if (connectedUsersButton) {
    connectedUsersButton.addEventListener('click', function(event) {
      event.stopPropagation();
      if (!onlineUsersList.length) return;
      const popup = ensureOnlineUsersPopup();
      if (!popup) return;
      if (popup.style.display === 'block') {
        hideOnlineUsersPopup();
      } else {
        renderOnlineUsersPopup();
      }
    });
  }

  document.addEventListener('click', function(event) {
    if (!onlineUsersPopup) return;
    if (!connectedUsersButton || connectedUsersButton.contains(event.target)) return;
    if (onlineUsersPopup.contains(event.target)) return;
    hideOnlineUsersPopup();
  });

  async function openProfileEditor() {
    const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
    const fullName = currentUser?.name || currentUser?.full_name || currentUser?.identifier || 'Utilisateur';
    const identifier = currentUser?.identifier || currentUser?.username || '';
    const role = currentUser?.role ? String(currentUser.role) : '';
    const avatarUrl = currentUser?.avatar_url || '';
    const initials = fullName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || 'U';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:16px;padding:24px;max-width:520px;width:100%;box-shadow:0 18px 48px rgba(0,0,0,0.18);color:#111;text-align:center;';
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:20px;flex-wrap:wrap;text-align:center;">
        <div style="display:flex;align-items:center;gap:16px;min-width:0;">
          <div style="width:72px;height:72px;border-radius:50%;background:#eef2ff;color:#2c3a8a;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;flex-shrink:0;">${initials}</div>
          <div style="min-width:0;">
            <div style="font-size:20px;font-weight:700;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${fullName.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            <div style="font-size:14px;color:#5f6675;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${identifier.replace(/</g,'&lt;').replace(/>/g,'&gt;')}
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
          <button type="button" id="profileEditBtn" class="nav-user-button" style="padding:10px 14px;font-size:13px;">Modifier</button>
          <button type="button" id="profileLogoutBtn" class="nav-logout" style="padding:10px 14px;font-size:13px;">Déconnexion</button>
        </div>
      </div>

      <div id="profileEditSection" style="display:none;border-top:1px solid #e8eaed;padding-top:20px;gap:16px;text-align:center;">
        <div style="display:grid;gap:12px;place-items:center;">
          <div style="display:grid;gap:6px;text-align:center;width:100%;max-width:420px;">
            <label style="font-size:12px;font-weight:600;color:#334155;">Nom complet</label>
            <input id="profileName" value="${(fullName || '').replace(/"/g, '&quot;')}" style="width:100%;padding:12px;border:1px solid #d8dee8;border-radius:12px;font-size:14px;" />
          </div>
          <div style="display:grid;gap:6px;text-align:center;width:100%;max-width:420px;">
            <label style="font-size:12px;font-weight:600;color:#334155;">Identifiant</label>
            <input id="profileIdentifier" value="${(identifier || '').replace(/"/g, '&quot;')}" style="width:100%;padding:12px;border:1px solid #d8dee8;border-radius:12px;font-size:14px;" />
          </div>
          <div style="display:grid;gap:6px;text-align:center;width:100%;max-width:420px;">
            <label style="font-size:12px;font-weight:600;color:#334155;">Nouveau mot de passe</label>
            <input id="profilePassword" type="password" placeholder="Laisser vide pour ne pas changer" style="width:100%;padding:12px;border:1px solid #d8dee8;border-radius:12px;font-size:14px;" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
          <button type="button" id="profileCancelBtn" class="nav-logout" style="padding:10px 14px;font-size:13px;">Annuler</button>
          <button type="button" id="profileSaveBtn" class="nav-user-button" style="padding:10px 14px;font-size:13px;">Enregistrer</button>
        </div>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const editSection = document.getElementById('profileEditSection');
    const editBtn = document.getElementById('profileEditBtn');
    const cancelBtn = document.getElementById('profileCancelBtn');
    const logoutBtn = document.getElementById('profileLogoutBtn');
    const saveBtn = document.getElementById('profileSaveBtn');

    const close = () => overlay.remove();
    cancelBtn.addEventListener('click', () => {
      if (editSection) {
        editSection.style.display = 'none';
      }
      if (editBtn) {
        editBtn.style.display = 'inline-flex';
      }
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    if (editBtn && editSection) {
      editBtn.addEventListener('click', () => {
        editSection.style.display = 'grid';
        editBtn.style.display = 'none';
      });
    }

    logoutBtn.addEventListener('click', async () => {
      await window.logout();
      close();
    });

    saveBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('profileName');
      const identifierInput = document.getElementById('profileIdentifier');
      const passwordInput = document.getElementById('profilePassword');
      const nextName = nameInput?.value?.trim() || '';
      const nextIdentifier = identifierInput?.value?.trim() || '';
      const nextAvatarUrl = document.getElementById('profileAvatarUrl')?.value?.trim() || '';
      const nextPassword = passwordInput?.value || '';

      if (!nextName || !nextIdentifier) {
        if (typeof showToast === 'function') {
          showToast('Le nom et l’identifiant sont obligatoires.', 'error');
        }
        return;
      }

      const token = localStorage.getItem('authToken');
      if (!token) {
        close();
        return;
      }

      try {
        const response = await fetch(apiUrl('/api/auth/profile'), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ name: nextName, identifier: nextIdentifier, avatar_url: nextAvatarUrl, password: nextPassword })
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.message || 'Impossible de mettre à jour le profil');
        }

        const updatedUser = {
          ...(currentUser || {}),
          ...data.user,
          name: data.user?.name || nextName,
          full_name: data.user?.name || nextName,
          avatar_url: data.user?.avatar_url || nextAvatarUrl || currentUser?.avatar_url || null,
          identifier: data.user?.identifier || nextIdentifier,
          username: data.user?.identifier || nextIdentifier
        };

        localStorage.setItem('user', JSON.stringify(updatedUser));
        updateUserLabel(updatedUser);
        if (editSection) editSection.style.display = 'none';
        if (editBtn) editBtn.style.display = 'inline-flex';
        if (typeof showToast === 'function') {
          showToast('✅ Profil mis à jour', 'success');
        }
      } catch (err) {
        if (typeof showToast === 'function') {
          showToast(err.message || 'Impossible de mettre à jour le profil', 'error');
        }
      }
    });
  }

  async function checkSessionInternal() {
    const token = localStorage.getItem('authToken');
    if (!token) {
      clearAuthSession();
      updateUserLabel(null);
      updateConnectedUsersNames([]);
      setAuthenticated(false);
      return;
    }

    try {
      const response = await fetch(apiUrl('/api/auth/me'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        persistAuthSession(token, data.user);
        updateUserLabel(data.user);
        await fetchOnlineUsers();
        if (typeof toggleAdminCreateSection === 'function') {
          toggleAdminCreateSection(data.user);
        }
        setAuthenticated(true);
        window.startInactivityAutoLogout();
        if (typeof window.startSilentBackgroundRefresh === 'function') {
          window.startSilentBackgroundRefresh();
        }
      } else {
        clearAuthSession();
        updateUserLabel(null);
        setAuthenticated(false);
      }
    } catch (err) {
      clearAuthSession();
      updateUserLabel(null);
      setAuthenticated(false);
    }
  }

  function checkSession() {
    if (sessionCheckPromise) return sessionCheckPromise;
    sessionCheckPromise = checkSessionInternal().finally(() => {
      sessionCheckPromise = null;
    });
    return sessionCheckPromise;
  }

  async function login(event) {
    event.preventDefault();
    const username = document.getElementById('loginIdentifier')?.value.trim().toLowerCase();
    const password = document.getElementById('loginPassword')?.value.trim();

    if (!username || !password) {
      setAuthMessage('Veuillez saisir un identifiant et un mot de passe.', 'error');
      if (typeof showToast === 'function') {
        showToast('Veuillez saisir un identifiant et un mot de passe', 'error');
      }
      return;
    }

    const submitButton = authForm?.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Connexion en cours...';
    }

    setAuthMessage('Connexion en cours...', 'loading');

    try {
      const response = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Réponse non JSON reçue:', text.substring(0, 200));
        throw new Error('Le serveur a renvoyé une erreur. Veuillez vérifier que le backend est démarré et accessible.');
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Échec de connexion');
      }

      if (!data.token) {
        throw new Error('Token non reçu du serveur');
      }

      persistAuthSession(data.token, data.user);
      window.startInactivityAutoLogout();

      setAuthMessage('Connexion réussie. Actualisation...', 'success');
      if (authForm) {
        authForm.reset();
      }

      window.location.reload();
      return;
    } catch (err) {
      console.error('Erreur login:', err);
      setAuthMessage(err.message || 'Erreur réseau lors de la connexion.', 'error');
      if (typeof showToast === 'function') {
        showToast(err.message || 'Échec de connexion', 'error');
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Se connecter';
      }
    }
  }

  function toggleRegisterForm(show) {
    if (authForm) {
      authForm.style.display = show ? 'none' : 'flex';
    }
    if (registerForm) {
      registerForm.style.display = show ? 'flex' : 'none';
    }
    if (showRegisterBtn) {
      showRegisterBtn.style.display = show ? 'none' : 'inline-block';
      showRegisterBtn.textContent = 'Pas encore de compte ? Créer un compte';
    }
  }

  function showLoginForm() {
    toggleRegisterForm(false);
  }

  function showRegisterPrompt() {
    toggleRegisterForm(true);
  }

  async function register(event) {
    event.preventDefault();
    const fullName = document.getElementById('registerFullName')?.value.trim() || '';
    const username = document.getElementById('registerIdentifier')?.value.trim().toLowerCase() || '';
    const password = document.getElementById('registerPassword')?.value.trim() || '';
    const role = document.getElementById('registerRole')?.value || 'back office';

    if (!fullName || !username || !password) {
      setAuthMessage('Veuillez remplir le nom complet, l’identifiant et le mot de passe.', 'error');
      if (typeof showToast === 'function') {
        showToast('Tous les champs marqués * sont obligatoires', 'error');
      }
      return;
    }
    if (password.length < 6) {
      setAuthMessage('Le mot de passe doit contenir au moins 6 caractères.', 'error');
      if (typeof showToast === 'function') {
        showToast('Le mot de passe doit contenir au moins 6 caractères', 'error');
      }
      return;
    }
    const submitButton = registerForm?.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Création...';
    }

    setAuthMessage('Création du compte...', 'loading');

    try {
      const response = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: username,
          name: fullName,
          password,
          role
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || data.detail || 'Erreur lors de la création du compte');
      }

      setAuthMessage('Compte créé avec succès. Vous êtes redirigé vers la connexion.', 'success');
      if (typeof showToast === 'function') {
        showToast('✅ Compte créé avec succès ! Vous pouvez maintenant vous connecter.', 'success');
      }
      if (registerForm) {
        registerForm.reset();
      }
      showLoginForm();
      const loginInput = document.getElementById('loginIdentifier');
      if (loginInput) {
        loginInput.value = username;
        loginInput.focus();
      }
    } catch (err) {
      console.error('Erreur inscription:', err);
      setAuthMessage(err.message || 'Erreur réseau lors de la création du compte.', 'error');
      if (typeof showToast === 'function') {
        showToast(err.message || 'Erreur lors de la création du compte', 'error');
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Créer le compte';
      }
    }
  }

  window.logout = async function() {
    clearInactivityAutoLogout();
    clearHiddenTabLogout();
    const token = localStorage.getItem('authToken');
    if (token) {
      try {
        await fetch(apiUrl('/api/auth/logout'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (err) {
        console.warn(err);
      }
    }

    clearAuthSession();
    updateUserLabel(null);
    updateConnectedUsersNames([]);
    if (typeof toggleAdminCreateSection === 'function') {
      toggleAdminCreateSection(null);
    }
    setAuthenticated(false);

    await refreshAppAfterAuthChange();

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  };

  window.addEventListener('storage', (event) => {
    if (event.key !== 'authPresenceSignal') return;
    try {
      const payload = JSON.parse(event.newValue || '{}');
      if (!payload?.action) return;
      if (payload.action === 'logout' && payload.userId) {
        cachedOnlineUsers = cachedOnlineUsers.filter((user) => String(user.id) !== String(payload.userId));
        updateConnectedUsersNames(cachedOnlineUsers);
      } else {
        window.fetchOnlineUsers?.().catch(() => {});
      }
    } catch (err) {
      console.warn('Impossible de traiter le signal de présence', err);
    }
  });

  if (authForm) {
    authForm.addEventListener('submit', login);
  }

  if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', () => {
      const willShowRegister = authForm && authForm.style.display !== 'none';
      toggleRegisterForm(willShowRegister);
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', register);
  }

  document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    window.startInactivityAutoLogout();
  });
  window.checkSession = checkSession;
  window.openProfileEditor = openProfileEditor;
  window.clearAuthSession = clearAuthSession;
  window.persistAuthSession = persistAuthSession;
  window.fetchOnlineUsers = fetchOnlineUsers;
})();