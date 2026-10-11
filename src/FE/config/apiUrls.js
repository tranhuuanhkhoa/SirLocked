// Shared by the Vite proxy and browser navigation into development OAuth.
export const DEFAULT_API_URL = 'http://localhost:5215';

export function googleLoginUrl(isDevelopment, apiUrl) {
  // Production uses the site's API/reverse proxy. In development, begin OAuth
  // on the API host so the correlation cookie and provider callback share it.
  if (!isDevelopment) return '/api/auth/google';
  return new URL('/api/auth/google', apiUrl || DEFAULT_API_URL).href;
}
