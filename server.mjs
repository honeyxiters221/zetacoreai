// ZetaCore AI API server. Provider credentials stay in server environment variables.
// Run with Node 20.6+: node --env-file=.env server.mjs

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dlidztiuttjwloyvdyeb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsaWR6dGl1dHRqd2xveXZkeWViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MjE0MzgsImV4cCI6MjEwNzk5NzQzOH0.Y-SNDQ2qgqCHg9jKXCA5put6kvIbVB4ZAzf5qyppxuI';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HEDGE_MS = 1;
const GEMINI_TIMEOUT_MS = 15000;
const OPENROUTER_TIMEOUT_MS = 15000;
const COOLDOWN_MS = 60000;
const OPENROUTER_PREFERRED_MODELS = [
  { id: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder 480B (Free)' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'NVIDIA Nemotron 3 Ultra (Free)' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct (Free)' },
  { id: 'poolside/laguna-s-2.1:free', label: 'Poolside Laguna S 2.1 (Free)' },
];
const OPENROUTER_MODE_ORDER = {
  instant: [
    'qwen/qwen3-coder:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'poolside/laguna-s-2.1:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
  ],
  deep: [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'qwen/qwen3-coder:free',
    'poolside/laguna-s-2.1:free',
    'meta-llama/llama-3.3-70b-instruct:free',
  ],
};

const PROVIDERS = [
  {
    name: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keys: [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean),
    models: { instant: 'gemini-2.5-flash-lite', deep: 'gemini-3.8-flash' },
  },
  {
    name: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key: process.env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': PUBLIC_APP_URL, 'X-Title': 'ZetaCore AI' },
    models: {},
  },
].filter(provider => provider.keys?.length || provider.key);

function loadCustomProviders() {
  if (!process.env.CUSTOM_MODELS) return [];
  let models;
  try {
    models = JSON.parse(process.env.CUSTOM_MODELS);
  } catch {
    throw new Error('CUSTOM_MODELS must contain a valid JSON array');
  }
  if (!Array.isArray(models)) throw new Error('CUSTOM_MODELS must contain a JSON array');
  return models.map((model, index) => {
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      throw new Error(`CUSTOM_MODELS entry ${index + 1} must be an object`);
    }
    const { id, label, mode, url, model: modelName, apiKeyEnv } = model;
    if (![id, label, modelName, apiKeyEnv].every(value => typeof value === 'string' && value.trim())) {
      throw new Error(`CUSTOM_MODELS entry ${index + 1} needs id, label, model, and apiKeyEnv`);
    }
    if (!['instant', 'deep'].includes(mode)) {
      throw new Error(`CUSTOM_MODELS entry ${index + 1} mode must be instant or deep`);
    }
    if (!/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) {
      throw new Error(`CUSTOM_MODELS entry ${index + 1} apiKeyEnv must be an environment variable name`);
    }
    let endpoint;
    try {
      endpoint = new URL(url);
    } catch {
      throw new Error(`CUSTOM_MODELS entry ${index + 1} has an invalid URL`);
    }
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))) {
      throw new Error(`CUSTOM_MODELS entry ${index + 1} URL must use HTTPS (HTTP is allowed for localhost)`);
    }
    const key = process.env[apiKeyEnv];
    if (!key) throw new Error(`Missing API key environment variable: ${apiKeyEnv}`);
    const headers = model.headers && typeof model.headers === 'object' && !Array.isArray(model.headers)
      ? Object.fromEntries(Object.entries(model.headers).filter(([, value]) => typeof value === 'string'))
      : {};
    return {
      name: id.trim(),
      label: label.trim(),
      url: endpoint.href,
      key,
      headers,
      models: { [mode]: modelName.trim() },
    };
  });
}

PROVIDERS.push(...loadCustomProviders());
const openRouterProvider = PROVIDERS.find(provider => provider.name === 'openrouter');
let openRouterModels = [];
if (openRouterProvider) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${openRouterProvider.key}`,
        'HTTP-Referer': PUBLIC_APP_URL,
        'X-Title': 'ZetaCore AI',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error(`[model discovery] OpenRouter catalog HTTP ${response.status}`);
    } else {
      const catalog = await response.json();
      openRouterModels = (Array.isArray(catalog.data) ? catalog.data : [])
        .filter(model => model && typeof model.id === 'string'
          && model.architecture?.input_modalities?.includes('text')
          && model.architecture?.output_modalities?.includes('text')
          && Number(model.pricing?.prompt) === 0
          && Number(model.pricing?.completion) === 0
          && (!model.expiration_date || new Date(model.expiration_date) > new Date()))
        .map(model => ({
          id: model.id,
          label: OPENROUTER_PREFERRED_MODELS.find(preferred => preferred.id === model.id)?.label
            || model.name,
          supportsImages: model.architecture?.input_modalities?.includes('image') || false,
          supportsTemperature: model.supported_parameters?.includes('temperature') || false,
        }));
      const preferredOrder = new Map(OPENROUTER_PREFERRED_MODELS.map((model, index) => [model.id, index]));
      openRouterModels.sort((left, right) =>
        (preferredOrder.get(left.id) ?? OPENROUTER_PREFERRED_MODELS.length)
          - (preferredOrder.get(right.id) ?? OPENROUTER_PREFERRED_MODELS.length)
        || left.label.localeCompare(right.label)
      );
      if (!openRouterModels.length) console.warn('[model discovery] No free text models were returned');
    }
  } catch (error) {
    console.error('[model discovery] OpenRouter catalog request failed:', error.message);
  }
}
const cooling = new Map();
const isCooling = name => (cooling.get(name) || 0) > Date.now();
const routeDefinitions = PROVIDERS.flatMap(provider => {
  if (provider === openRouterProvider) {
    return ['instant', 'deep'].flatMap(mode => {
      const preferredOrder = new Map(OPENROUTER_MODE_ORDER[mode].map((id, index) => [id, index]));
      return [...openRouterModels]
        .sort((left, right) =>
          (preferredOrder.get(left.id) ?? OPENROUTER_MODE_ORDER[mode].length)
            - (preferredOrder.get(right.id) ?? OPENROUTER_MODE_ORDER[mode].length)
          || left.label.localeCompare(right.label)
        )
        .map(({ id: model, label, supportsImages, supportsTemperature }) => ({
          provider, mode, model, label, supportsTemperature, supportsImages,
        }));
    });
  }
  return Object.entries(provider.models).map(([mode, model]) => ({
    provider, mode, model, label: model, supportsTemperature: true, supportsImages: true,
  }));
});
const modelNumberByMode = { instant: 0, deep: 0 };
const MODEL_ROUTES = routeDefinitions.map(route => {
  const number = ++modelNumberByMode[route.mode];
  return {
    ...route,
    id: `zeta-${route.mode}-${number}`,
    label: route.provider.name === 'gemini'
      ? `${route.label}${route.mode === 'deep' ? ' · Deep' : ' · Instant'}`
      : `${route.provider.name === 'openrouter' ? 'OpenRouter' : route.provider.label || route.provider.name} · ${route.label}`,
  };
});
if (new Set(MODEL_ROUTES.map(route => route.id)).size !== MODEL_ROUTES.length) {
  throw new Error('Provider and custom model IDs must be unique');
}

async function callProvider(route, messages, signal) {
  const { provider, mode, model } = route;
  const apiKey = route.apiKey || provider.key;
  const response = await fetch(provider.url, {
    method: 'POST',
    headers: {
      ...(provider.headers || {}),
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(route.supportsTemperature ? { temperature: mode === 'deep' ? 0.3 : 0.7 } : {}),
    }),
    signal,
  });
  if (response.status === 429) {
    cooling.set(route.cooldownKey || `${provider.name}:${model}`, Date.now() + COOLDOWN_MS);
    throw new Error(`${provider.name}: rate limit`);
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    const detail = typeof result?.error?.message === 'string' ? result.error.message
      : typeof result?.message === 'string' ? result.message : '';
    const safeDetail = detail.replace(/[\r\n\t]+/g, ' ')
      .replaceAll(apiKey, '[redacted]').slice(0, 300);
    throw new Error(`${provider.name}: HTTP ${response.status}${safeDetail ? ` - ${safeDetail}` : ''}`);
  }
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error(`${provider.name}: invalid chat completion response`);
  return { content };
}

async function askAI(mode, messages, modelId) {
  const route = modelId === 'auto' ? null : MODEL_ROUTES.find(item => item.id === modelId && item.mode === mode);
  if (modelId !== 'auto' && !route) return Promise.reject(new Error('Selected model is not available for this mode'));
  const hasImages = messages.some(message => Array.isArray(message.content)
    && message.content.some(part => part && typeof part === 'object' && part.type === 'image_url'));
  const candidates = route ? [route] : MODEL_ROUTES.filter(item => item.mode === mode);
  if (hasImages && !candidates.length) {
    return Promise.reject(Object.assign(new Error('No configured model supports image attachments'), { code: 'unsupported_attachments' }));
  }
  if (hasImages && route && !route.supportsImages) {
    return Promise.reject(Object.assign(new Error('Selected model does not support image attachments'), { code: 'unsupported_attachments' }));
  }
  const providerGroups = [];
  for (const candidate of candidates) {
    if (hasImages && !candidate.supportsImages) continue;
    let group = providerGroups.find(item => item.provider === candidate.provider);
    if (!group) {
      group = { provider: candidate.provider, routes: [] };
      providerGroups.push(group);
    }
    group.routes.push(candidate);
  }
  if (!providerGroups.length) {
    return Promise.reject(Object.assign(new Error('No configured model supports image attachments'), { code: 'unsupported_attachments' }));
  }

  const failures = [];
  const makeAttempts = group => group.routes.flatMap(candidate => {
    const keys = candidate.provider.keys;
    if (!keys?.length) return [{ ...candidate, cooldownKey: `${candidate.provider.name}:${candidate.model}` }];
    return keys.map((apiKey, index) => ({
      ...candidate,
      apiKey,
      cooldownKey: `${candidate.provider.name}:${index}`,
    }));
  });
  const runBatch = async attempts => {
    const controllers = [];
    let succeeded = false;
    const work = attempts.map(async (candidate, index) => {
      if (index) await new Promise(resolveDelay => setTimeout(resolveDelay, HEDGE_MS));
      if (succeeded) return null;
      const controller = new AbortController();
      controllers.push(controller);
      const timeoutMs = candidate.provider.name === 'gemini' ? GEMINI_TIMEOUT_MS : OPENROUTER_TIMEOUT_MS;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        return await callProvider(candidate, messages, controller.signal);
      } catch (error) {
        if (!succeeded) {
          const message = timedOut
            ? `${candidate.provider.name}: request timed out after ${timeoutMs / 1000}s`
            : error.message || `${candidate.provider.name}: request failed`;
          failures.push(message);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    });
    try {
      const result = await Promise.any(work);
      succeeded = true;
      return result;
    } catch {
      return null;
    } finally {
      controllers.forEach(controller => controller.abort());
    }
  };

  for (const group of providerGroups) {
    let attempts = makeAttempts(group);
    const healthy = attempts.filter(candidate => !isCooling(candidate.cooldownKey));
    if (healthy.length) attempts = healthy;
    const batchSize = group.provider.name === 'openrouter' ? 2 : attempts.length;
    for (let index = 0; index < attempts.length; index += batchSize) {
      const result = await runBatch(attempts.slice(index, index + batchSize));
      if (result) return result;
    }
  }

  console.error('[provider failures]', failures.join('; ') || 'No compatible provider routes');
  const error = new Error('All configured AI providers failed');
  if (failures.length && failures.every(failure => /\bHTTP 402\b|\bHTTP 429\b|rate limit/i.test(failure))) {
    error.code = 'rate_limited';
  }
  return Promise.reject(error);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml' };
function send(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      if (tooLarge) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 12_000_000) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      if (tooLarge) return rejectBody(Object.assign(new Error('Request is too large'), { code: 'request_too_large' }));
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { rejectBody(new Error('Invalid JSON')); }
    });
    request.on('error', rejectBody);
  });
}

async function getSupabaseUser(request) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '')?.[1];
  if (!token) return { status: 401, error: 'Please sign in to continue' };
  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return { status: 401, error: 'Your session is invalid or expired. Please sign in again.' };
  const user = await response.json();
  if (!user?.id || !user.email) return { status: 401, error: 'Supabase returned an invalid user session.' };
  return { user };
}

async function handleChat(request, response) {
  try {
    const auth = await getSupabaseUser(request);
    if (auth.error) return send(response, auth.status, 'application/json', JSON.stringify({ error: auth.error }));
    if (auth.user.user_metadata?.zetacore_deactivated_at) {
      return send(response, 403, 'application/json', JSON.stringify({ error: 'This account is temporarily deactivated. Sign in to reactivate it.' }));
    }
    const body = await readBody(request);
    const mode = body.mode === 'deep' ? 'deep' : 'instant';
    const modelId = typeof body.modelId === 'string' ? body.modelId : 'auto';
    const system = String(body.system || '').slice(0, 8000);
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length > 4) {
      return send(response, 400, 'application/json', JSON.stringify({ code: 'INVALID_ATTACHMENTS' }));
    }
    let totalAttachmentBytes = 0;
    const normalizedAttachments = attachments.map(attachment => {
      if (!attachment || typeof attachment !== 'object' || typeof attachment.name !== 'string') {
        throw Object.assign(new Error('Invalid attachment'), { code: 'invalid_attachments' });
      }
      const name = attachment.name.replace(/[\r\n\t]/g, ' ').slice(0, 160);
      const type = attachment.type;
      if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) {
        const match = typeof attachment.dataUrl === 'string'
          ? /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(attachment.dataUrl)
          : null;
        if (!match || match[1] !== type) {
          throw Object.assign(new Error('Invalid image attachment'), { code: 'invalid_attachments' });
        }
        const bytes = Buffer.from(match[2], 'base64');
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) {
          throw Object.assign(new Error('Image attachments must be 5 MB or smaller'), { code: 'invalid_attachments' });
        }
        totalAttachmentBytes += bytes.length;
        return { name, type, dataUrl: attachment.dataUrl, image: true };
      }
      if (!['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(type)
        || typeof attachment.content !== 'string'
        || Buffer.byteLength(attachment.content, 'utf8') > 200 * 1024) {
        throw Object.assign(new Error('Invalid text attachment'), { code: 'invalid_attachments' });
      }
      totalAttachmentBytes += Buffer.byteLength(attachment.content, 'utf8');
      return { name, type, content: attachment.content, image: false };
    });
    if (totalAttachmentBytes > 8 * 1024 * 1024) {
      return send(response, 400, 'application/json', JSON.stringify({ code: 'ATTACHMENTS_TOO_LARGE' }));
    }
    const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-20).map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || '').slice(0, 8000),
    }));
    const lastUserMessage = [...messages].reverse().find(message => message.role === 'user');
    if (lastUserMessage && normalizedAttachments.length) {
      const content = [];
      if (lastUserMessage.content) content.push({ type: 'text', text: lastUserMessage.content });
      for (const attachment of normalizedAttachments) {
        if (attachment.image) {
          content.push({ type: 'text', text: `Attached image: ${attachment.name}` });
          content.push({ type: 'image_url', image_url: { url: attachment.dataUrl } });
        } else {
          content.push({ type: 'text', text: `Attached file: ${attachment.name}\n${attachment.content}` });
        }
      }
      lastUserMessage.content = content;
    }
    const result = await askAI(mode, [{ role: 'system', content: system }, ...messages], modelId);
    send(response, 200, 'application/json', JSON.stringify(result));
  } catch (error) {
    console.error('[chat]', error.message);
    if (error.code === 'unsupported_attachments') {
      return send(response, 400, 'application/json', JSON.stringify({ code: 'UNSUPPORTED_ATTACHMENTS' }));
    }
    if (error.code === 'invalid_attachments') {
      return send(response, 400, 'application/json', JSON.stringify({ code: 'INVALID_ATTACHMENTS' }));
    }
    if (error.code === 'request_too_large') {
      return send(response, 413, 'application/json', JSON.stringify({ code: 'REQUEST_TOO_LARGE' }));
    }
    if (error.code === 'rate_limited') {
      return send(response, 429, 'application/json', JSON.stringify({ code: 'RATE_LIMITED' }));
    }
    const status = error.message === 'No model is configured for this mode' ? 503 : 502;
    send(response, status, 'application/json', JSON.stringify({ code: status === 503 ? 'AI_NOT_CONFIGURED' : 'AI_SERVICE_UNAVAILABLE' }));
  }
}

async function handleAccountDeletion(request, response) {
  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return send(response, 503, 'application/json', JSON.stringify({
        error: 'Permanent account deletion is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server .env file and restart the server.'
      }));
    }
    const auth = await getSupabaseUser(request);
    if (auth.error) return send(response, auth.status, 'application/json', JSON.stringify({ error: auth.error }));
    const body = await readBody(request);
    if (typeof body.confirmEmail !== 'string' || body.confirmEmail.trim().toLowerCase() !== auth.user.email.toLowerCase()) {
      return send(response, 400, 'application/json', JSON.stringify({ error: 'Confirmation email does not match the signed-in account.' }));
    }
    const deleteResponse = await fetch(
      `${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/admin/users/${encodeURIComponent(auth.user.id)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!deleteResponse.ok) {
      const result = await deleteResponse.json().catch(() => ({}));
      throw new Error(result.msg || result.message || `Supabase account deletion failed (${deleteResponse.status}).`);
    }
    send(response, 200, 'application/json', JSON.stringify({ deleted: true }));
  } catch (error) {
    console.error('[account deletion]', error.message);
    send(response, 502, 'application/json', JSON.stringify({ error: error.message || 'Account deletion failed.' }));
  }
}

async function serveStatic(pathname, response) {
  let relativePath;
  try {
    relativePath = pathname === '/' ? 'dashboard.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return send(response, 400, 'text/plain', 'Invalid path');
  }
  if (!['dashboard.html', 'index.html', 'zetacore-mark.svg'].includes(relativePath)) return send(response, 404, 'text/plain', 'Not found');
  try {
    const file = resolve(ROOT, relativePath);
    const data = await readFile(file);
    const type = relativePath.endsWith('.svg') ? MIME['.svg'] : MIME['.html'];
    send(response, 200, type, data);
  } catch {
    send(response, 404, 'text/plain', 'Not found');
  }
}

export async function routeRequest(request, response) {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (request.method === 'POST' && url.pathname === '/api/chat') return handleChat(request, response);
  if (request.method === 'POST' && url.pathname === '/api/account/delete') return handleAccountDeletion(request, response);
  if (request.method === 'GET' && url.pathname === '/api/config') {
    return send(response, 200, 'application/json', JSON.stringify({
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      authEnabled: true,
    }));
  }
  if (request.method === 'GET' && url.pathname === '/api/status') {
    return send(response, 200, 'application/json', JSON.stringify({
      providerCount: PROVIDERS.length,
      models: MODEL_ROUTES.map(({ id, label, mode, provider, model, supportsImages }) => ({
        id, label, mode, provider: provider.name, model, supportsImages,
      })),
    }));
  }
  if (request.method === 'GET') return serveStatic(url.pathname, response);
  send(response, 405, 'text/plain', 'Method not allowed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = http.createServer(routeRequest);
  server.listen(PORT, '0.0.0.0', () => {
    const names = PROVIDERS.map(provider => provider.name).join(', ') || 'NONE (configure provider keys in .env)';
    console.log(`ZetaCore running → ${PUBLIC_APP_URL}`);
    console.log(`Providers: ${names}`);
  });
}
