const API_ORIGIN = 'https://api.sirlocked.id.vn';

export function proxyToApi(request) {
  const source = new URL(request.url);
  const destination = new URL(source.pathname + source.search, API_ORIGIN);
  return fetch(new Request(destination, request));
}
