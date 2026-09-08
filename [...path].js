const crypto = require('crypto');

const KROGER_API = 'https://api.kroger.com/v1';
const KROGER_AUTHORIZE = 'https://api.kroger.com/v1/connect/oauth2/authorize';
const KROGER_TOKEN = 'https://api.kroger.com/v1/connect/oauth2/token';
const COOKIE_NAME = 'cb_kroger_session';
const STATE_COOKIE = 'cb_kroger_state';

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing Vercel environment variable: ${name}`);
  return value;
}

function redirectUri(req) {
  return process.env.KROGER_REDIRECT_URI || `https://${req.headers.host}/api/auth/kroger/callback`;
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  });
  return out;
}

function cookie(name, value, maxAge = 60 * 60 * 24 * 30) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function sessionKey() {
  return crypto.createHash('sha256').update(env('SESSION_SECRET')).digest();
}

function encryptSession(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(data));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function decryptSession(value) {
  try {
    const buf = Buffer.from(value, 'base64url');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.statusCode = status;
  Object.entries(extraHeaders).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function redirect(res, location, headers = {}) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end();
}

async function bodyJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function krogerClientToken() {
  const clientId = env('KROGER_CLIENT_ID');
  const clientSecret = env('KROGER_CLIENT_SECRET');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(KROGER_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || 'Kroger client token failed');
  return data.access_token;
}

async function refreshUserSession(session) {
  if (!session?.refresh_token) return null;
  const clientId = env('KROGER_CLIENT_ID');
  const clientSecret = env('KROGER_CLIENT_SECRET');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(KROGER_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refresh_token
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  return {
    ...session,
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: Date.now() + Math.max(30, Number(data.expires_in || 1800) - 60) * 1000
  };
}

async function getUserSession(req, res) {
  const cookies = parseCookies(req);
  let session = cookies[COOKIE_NAME] ? decryptSession(cookies[COOKIE_NAME]) : null;
  if (!session) return null;
  if (session.expires_at && Date.now() >= session.expires_at) {
    const refreshed = await refreshUserSession(session);
    if (!refreshed) {
      res.setHeader('Set-Cookie', clearCookie(COOKIE_NAME));
      return null;
    }
    session = refreshed;
    res.setHeader('Set-Cookie', cookie(COOKIE_NAME, encryptSession(session)));
  }
  return session;
}

async function handleStores(req, res, url) {
  const zip = url.searchParams.get('zip');
  if (!/^\d{5}$/.test(zip || '')) return sendJson(res, 400, { error: 'A valid 5-digit ZIP code is required.' });
  const token = await krogerClientToken();
  const params = new URLSearchParams({
    'filter.zipCode.near': zip,
    'filter.radiusInMiles': url.searchParams.get('radius') || '15',
    'filter.limit': url.searchParams.get('limit') || '10'
  });
  const response = await fetch(`${KROGER_API}/locations?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return sendJson(res, response.status, { error: data?.errors || 'Kroger locations request failed.' });
  const locations = (data.data || []).map(x => ({
    id: x.locationId,
    name: x.name,
    chain: x.chain,
    address: x.address,
    hours: x.hours,
    modalities: x.modality || x.modalities || []
  }));
  return sendJson(res, 200, { data: locations });
}

async function handleProducts(req, res, url) {
  const term = (url.searchParams.get('term') || '').trim();
  const locationId = (url.searchParams.get('locationId') || '').trim();
  if (!term || !locationId) return sendJson(res, 400, { error: 'term and locationId are required.' });
  const token = await krogerClientToken();
  const params = new URLSearchParams({
    'filter.term': term,
    'filter.locationId': locationId,
    'filter.limit': url.searchParams.get('limit') || '8'
  });
  const response = await fetch(`${KROGER_API}/products?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return sendJson(res, response.status, { error: data?.errors || 'Kroger products request failed.' });
  return sendJson(res, 200, { data: data.data || [] });
}

async function handleAuthStart(req, res) {
  const state = crypto.randomBytes(24).toString('hex');
  const params = new URLSearchParams({
    scope: process.env.KROGER_SCOPES || 'cart.basic:write product.compact profile.compact',
    response_type: 'code',
    client_id: env('KROGER_CLIENT_ID'),
    redirect_uri: redirectUri(req),
    state
  });
  return redirect(res, `${KROGER_AUTHORIZE}?${params}`, { 'Set-Cookie': cookie(STATE_COOKIE, state, 600) });
}

async function handleAuthCallback(req, res, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const cookies = parseCookies(req);
  if (error) return redirect(res, `/?kroger=error&message=${encodeURIComponent(error)}`, { 'Set-Cookie': clearCookie(STATE_COOKIE) });
  if (!code || !state || state !== cookies[STATE_COOKIE]) {
    return redirect(res, '/?kroger=error&message=Invalid%20OAuth%20state');
  }
  const clientId = env('KROGER_CLIENT_ID');
  const clientSecret = env('KROGER_CLIENT_SECRET');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(KROGER_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(req)
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    return redirect(res, `/?kroger=error&message=${encodeURIComponent(data.error_description || data.error || 'Kroger authorization failed')}`, { 'Set-Cookie': clearCookie(STATE_COOKIE) });
  }
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + Math.max(30, Number(data.expires_in || 1800) - 60) * 1000
  };
  const headers = {
    'Set-Cookie': [
      cookie(COOKIE_NAME, encryptSession(session), 60 * 60 * 24 * 30),
      clearCookie(STATE_COOKIE)
    ]
  };
  return redirect(res, '/?kroger=connected', headers);
}

async function handleAuthStatus(req, res) {
  const session = await getUserSession(req, res);
  return sendJson(res, 200, { connected: !!session });
}

async function handleLogout(req, res) {
  return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(COOKIE_NAME) });
}

async function handleCartAdd(req, res) {
  const session = await getUserSession(req, res);
  if (!session) return sendJson(res, 401, { error: 'Connect your Kroger account first.' });
  const body = await bodyJson(req);
  if (!Array.isArray(body.items) || !body.items.length) return sendJson(res, 400, { error: 'No cart items supplied.' });
  const items = body.items.map(item => ({
    quantity: Math.max(1, Number(item.quantity || 1)),
    upc: String(item.upc || ''),
    modality: String(item.modality || 'ais')
  })).filter(item => /^\d{8,14}$/.test(item.upc));
  if (!items.length) return sendJson(res, 400, { error: 'No valid UPCs supplied.' });
  const response = await fetch(`${KROGER_API}/cart/add`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ items })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return sendJson(res, response.status, { error: data?.errors || data?.error_description || 'Kroger cart request failed.' });
  }
  return sendJson(res, 200, { ok: true, count: items.length });
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');

    if (req.method === 'GET' && path === 'auth/kroger') return handleAuthStart(req, res);
    if (req.method === 'GET' && path === 'auth/kroger/callback') return handleAuthCallback(req, res, url);
    if (req.method === 'GET' && path === 'auth/status') return handleAuthStatus(req, res);
    if (req.method === 'POST' && path === 'auth/logout') return handleLogout(req, res);
    if (req.method === 'GET' && path === 'stores') return handleStores(req, res, url);
    if (req.method === 'GET' && path === 'products') return handleProducts(req, res, url);
    if (req.method === 'PUT' && path === 'cart/add') return handleCartAdd(req, res);

    return sendJson(res, 404, { error: 'API route not found.' });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message || 'Server error.' });
  }
}
