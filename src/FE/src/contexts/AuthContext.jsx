import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clearStoredToken, getStoredToken, setStoredToken } from '../api/apiClient';
import { loginUser, registerUser } from '../api/authApi';
import { getMe } from '../api/userApi';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => getStoredToken());
  const [loading, setLoading] = useState(Boolean(getStoredToken()));
  const [error, setError] = useState('');

  const refreshMe = useCallback(async () => {
    if (!getStoredToken()) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await getMe();
      setUser(response.data);
      setError('');
    } catch (err) {
      clearStoredToken();
      setToken(null);
      setUser(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const login = async (credentials) => {
    const response = await loginUser(credentials);
    setStoredToken(response.data.accessToken);
    setToken(response.data.accessToken);
    setUser(response.data.user);
    setError('');
    return response.data.user;
  };

  const register = async (payload) => {
    const response = await registerUser(payload);
    setStoredToken(response.data.accessToken);
    setToken(response.data.accessToken);
    setUser(response.data.user);
    setError('');
    return response.data.user;
  };

  const logout = () => {
    clearStoredToken();
    setToken(null);
    setUser(null);
  };

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      error,
      isAuthenticated: Boolean(token && user),
      login,
      register,
      logout,
      refreshMe,
    }),
    [user, token, loading, error, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return context;
}
