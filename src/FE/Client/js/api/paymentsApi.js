import { get, post } from './http.js';

export const paymentsApi = {
  packages: () => get('/api/payments/packages'),
  history: () => get('/api/payments/orders'),
  create: (packageId, requestId) => post('/api/payments/orders', { packageId, requestId }),
  order: (code) => get(`/api/payments/orders/${encodeURIComponent(code)}`),
  cancel: (code) => post(`/api/payments/orders/${encodeURIComponent(code)}/cancel`),
};
