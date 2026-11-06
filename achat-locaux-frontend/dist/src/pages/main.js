// ============================================================
// MAIN – Point d'entrée
// ============================================================

// Fonctions de contrôle du loader
function showLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  requestAnimationFrame(() => {
    overlay.classList.remove('hidden');
  });
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  requestAnimationFrame(() => {
    overlay.classList.add('hidden');
  });
}

function queueIdleTask(callback) {
  if (typeof callback !== 'function') return;

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout: 500 });
    return;
  }

  setTimeout(() => {
    callback({
      didTimeout: true,
      timeRemaining: () => 50
    });
  }, 32);
}

// Fonction appelée par renderTab pour l'onglet Dossiers
function renderDossiers() {
  if (typeof initDossiersTable === 'function') {
    initDossiersTable(FILTERED);
  }
}

// Initialisation au chargement
document.addEventListener('DOMContentLoaded', async function() {
  // Afficher le loader
  showLoading();
  
  try {
    if (typeof restoreActiveTab === 'function') {
      restoreActiveTab();
    }
    if (typeof checkSession === 'function') {
      await checkSession();
    }
    const token = localStorage.getItem('authToken');
    if (!token) {
      hideLoading();
      return;
    }
    try {
      await loadDataFromAPI();
    } catch (err) {
      console.warn('Chargement initial des données a échoué :', err);
    }

    const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
    const isAdmin = String(currentUser?.role || '').trim().toLowerCase() === 'admin';
    if (isAdmin && typeof loadUsersAdmin === 'function') {
      queueIdleTask(() => loadUsersAdmin());
    }

    if (typeof window.startSilentBackgroundRefresh === 'function') {
      queueIdleTask(() => window.startSilentBackgroundRefresh());
    }
  } catch (err) {
    console.error('Erreur lors de l\'initialisation :', err);
  } finally {
    // Cacher le loader
    hideLoading();
  }
});