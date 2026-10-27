import { proxyToApi } from '../../config/pagesProxy.js';

export const onRequest = ({ request }) => proxyToApi(request);
