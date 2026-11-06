import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 5000,
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

let csrfToken = '';

api.interceptors.request.use((config) => {
  if (!['get', 'head', 'options'].includes((config.method || 'get').toLowerCase())) {
    if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

export async function initializeCsrf() {
  const response = await api.get('/auth/csrf');
  csrfToken = response.data.csrfToken;
  return csrfToken;
}

export async function getCurrentUser() {
  const response = await api.get('/auth/me');
  return response.data.user;
}

export async function registerAccount(values) {
  const response = await api.post('/auth/register', values);
  csrfToken = response.data.csrfToken || csrfToken;
  return response.data.user;
}

export async function loginAccount(values) {
  const response = await api.post('/auth/login', values);
  csrfToken = response.data.csrfToken || csrfToken;
  return response.data.user;
}

export async function logoutAccount() {
  try { await api.post('/auth/logout'); } finally { csrfToken = ''; }
}

export async function getHealth() {
  const response = await api.get('/health');
  return response.data;
}

// Call after a successful document or travel-record mutation to refresh open dashboards.
export function emitTrackerDataChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('tracker:data-changed'));
}

export default api;
