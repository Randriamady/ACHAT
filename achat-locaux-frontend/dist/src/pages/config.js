(function configureFrontend() {
  const configuredApiUrl = '__VITE_API_BASE_URL__';
  const browserHost = window.location.hostname || 'localhost';
  const apiBaseUrl = configuredApiUrl.startsWith('__')
    ? (window.location.protocol === 'https:'
      ? window.location.origin
      : `http://${browserHost}:8000`)
    : (configuredApiUrl || window.location.origin);

  window.APP_CONFIG = { API_BASE_URL: apiBaseUrl.replace(/\/$/, '') };
  window.apiUrl = function apiUrl(path) {
    return `${window.APP_CONFIG.API_BASE_URL}${path}`;
  };
})();