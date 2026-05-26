import * as signalR from '@microsoft/signalr';
import { getStoredToken } from '../api/apiClient';

export function getGameHubUrl() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5289/api';
  return apiBaseUrl.replace(/\/api$/, '/hubs/game');
}

export function createGameHubConnection() {
  return new signalR.HubConnectionBuilder()
    .withUrl(getGameHubUrl(), {
      accessTokenFactory: () => getStoredToken() || '',
    })
    .withAutomaticReconnect()
    .build();
}
