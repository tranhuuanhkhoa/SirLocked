// Shared by the Vite proxy and browser navigation into development OAuth.
export const DEFAULT_API_URL = 'http://localhost:5215';
export const PRODUCTION_API_URL = 'https://api.sirlocked.id.vn';

export function googleLoginUrl(isDevelopment, apiUrl) {
  // OAuth begins on the API host so its correlation cookie is sent to the
  // Google callback on that same host.
  if (!isDevelopment) return new URL('/api/auth/google', PRODUCTION_API_URL).href;
  return new URL('/api/auth/google', apiUrl || DEFAULT_API_URL).href;
}
