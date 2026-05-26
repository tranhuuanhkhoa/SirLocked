export function getGameHubUrl() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5289/api';
  return apiBaseUrl.replace(/\/api$/, '/hubs/game');
}
