import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getCurrentUser, initializeCsrf, loginAccount, logoutAccount, registerAccount } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    let active = true;
    let retryTimer;
    (async () => {
      let retries = 0;
      while (active) {
        try {
          await initializeCsrf();
          const currentUser = await getCurrentUser();
          if (active) {
            setUser(currentUser);
            setSessionError('');
            setLoading(false);
          }
          return;
        } catch (error) {
          if (!active) return;
          setUser(null);
          setLoading(false);

          // An expired or absent session is a normal signed-out state. Only
          // retry availability errors, not authorization responses.
          if (error.response?.status === 401) {
            setSessionError('');
            return;
          }

          setSessionError('The account service is temporarily unavailable. We are reconnecting automatically.');
          const delay = Math.min(30000, 1000 * (2 ** Math.min(retries, 5)));
          retries += 1;
          await new Promise((resolve) => { retryTimer = setTimeout(resolve, delay); });
        }
      }
    })();
    return () => { active = false; clearTimeout(retryTimer); };
  }, []);

  async function register(values) { await initializeCsrf(); const nextUser = await registerAccount(values); setUser(nextUser); setSessionError(''); return nextUser; }
  async function login(values) { await initializeCsrf(); const nextUser = await loginAccount(values); setUser(nextUser); setSessionError(''); return nextUser; }
  async function logout() {
    try { await logoutAccount(); } finally { setUser(null); try { await initializeCsrf(); } catch { /* Login will show an API error if the backend remains offline. */ } }
  }

  const value = useMemo(() => ({ user, loading, sessionError, register, login, logout, refreshUser: async () => setUser(await getCurrentUser()) }), [user, loading, sessionError]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
