import { routeRequest } from '../server.mjs';

export const maxDuration = 60;

export default async function handler(request, response) {
  try {
    await routeRequest(request, response);
  } catch (error) {
    console.error('[vercel api]', error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    response.end(JSON.stringify({ error: 'Internal server error' }));
  }
}
