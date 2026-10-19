import { Readable } from 'node:stream';
import { routeRequest } from '../../server.mjs';

const API_PATHS = new Set([
  '/api/chat',
  '/api/account/delete',
  '/api/config',
  '/api/status',
]);

export const config = {
  path: [...API_PATHS],
};

export async function handler(event) {
  const pathname = event.path || new URL(event.rawUrl).pathname;
  const request = Readable.from(event.body
    ? [event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body)]
    : []);
  request.url = API_PATHS.has(pathname) ? pathname : '/__not_found__';
  request.method = event.httpMethod || 'GET';
  request.headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([name, value]) => [name.toLowerCase(), value])
  );

  let statusCode = 200;
  let headers = {};
  let responseBody = '';
  const response = {
    writeHead(status, responseHeaders) {
      statusCode = status;
      headers = responseHeaders;
    },
    end(body = '') {
      responseBody = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    },
  };

  await routeRequest(request, response);
  return { statusCode, headers, body: responseBody };
}
