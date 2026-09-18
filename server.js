const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const port = Number(process.env.PORT || 10000);
const root = path.join(__dirname, 'cate.meme');
const dataFile = path.join(__dirname, 'visitors.json');
const adminPassword = process.env.ADMIN_PASSWORD || 'CATE-ADMIN-2026';
const sessions = new Set();

function readVisitors() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (_) { return []; }
}
function writeVisitors(visitors) {
  fs.writeFileSync(dataFile, JSON.stringify(visitors, null, 2));
}
function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(body);
}
function body(request) {
  return new Promise((resolve, reject) => {
    let value = '';
    request.on('data', chunk => { value += chunk; if (value.length > 10000) request.destroy(); });
    request.on('end', () => { try { resolve(value ? JSON.parse(value) : {}); } catch (_) { reject(new Error('Invalid JSON')); } });
    request.on('error', reject);
  });
}
function authorized(request) {
  const token = (request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return token && sessions.has(token);
}
function clientIp(request) {
  const candidates = [
    ...(request.headers['x-forwarded-for'] || '').split(','),
    request.headers['x-real-ip'] || '',
    request.socket.remoteAddress || ''
  ].map(value => value.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const mapped = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mapped) return mapped[1];
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) return candidate;
    if (candidate === '::1') return '127.0.0.1';
  }
  return 'Unavailable';
}
function lookupIp(ip) {
  if (ip === 'Unavailable' || ip === '127.0.0.1') return Promise.resolve({country: 'Unavailable', region: 'Unavailable', city: 'Unavailable', timezone: 'Unavailable', isp: 'Unavailable', asn: 'Unavailable', vpn: 'Unavailable'});
  return new Promise(resolve => {
    const request = https.get(`https://api.ipapi.is/?q=${encodeURIComponent(ip)}`, {timeout: 3000, headers: {'User-Agent': 'CATECOIN visitor analytics'}}, response => {
      let value = '';
      response.on('data', chunk => { value += chunk; });
      response.on('end', () => {
        try {
          const data = JSON.parse(value);
          const company = data.company || {};
          const provider = String(company.name || company.domain || data.asn?.name || '').trim();
          const isNextVpn = /next\s*-?\s*vpn/i.test(provider);
          const location = data.location || {};
          resolve({
            country: location.country || 'Unavailable',
            region: location.state || location.region || 'Unavailable',
            city: location.city || 'Unavailable',
            timezone: location.timezone || 'Unavailable',
            isp: provider || 'Unavailable',
            asn: data.asn?.asn ? `AS${data.asn.asn}` : 'Unavailable',
            vpn: isNextVpn ? 'Next VPN' : data.is_vpn === true ? `VPN${provider ? ` - ${provider}` : ''}` : data.is_proxy === true ? 'Proxy' : data.is_tor === true ? 'Tor' : 'No VPN detected'
          });
        } catch (_) { resolve({country: 'Unavailable', region: 'Unavailable', city: 'Unavailable', timezone: 'Unavailable', isp: 'Unavailable', asn: 'Unavailable', vpn: 'Unknown'}); }
      });
    });
    request.on('error', () => resolve({country: 'Unavailable', region: 'Unavailable', city: 'Unavailable', timezone: 'Unavailable', isp: 'Unavailable', asn: 'Unavailable', vpn: 'Unknown'}));
    request.on('timeout', () => { request.destroy(); resolve({country: 'Unavailable', region: 'Unavailable', city: 'Unavailable', timezone: 'Unavailable', isp: 'Unavailable', asn: 'Unavailable', vpn: 'Unknown'}); });
  });
}
function browser(userAgent) {
  const match = userAgent.match(/Edg\/([\d.]+)/) || userAgent.match(/Chrome\/([\d.]+)/) || userAgent.match(/Firefox\/([\d.]+)/) || userAgent.match(/Version\/([\d.]+).*Safari/);
  const name = userAgent.includes('Edg/') ? 'Edge' : userAgent.includes('Firefox/') ? 'Firefox' : userAgent.includes('Chrome/') ? 'Chrome' : userAgent.includes('Safari/') ? 'Safari' : 'Other';
  return name + (match ? ` ${match[1]}` : '');
}
function device(userAgent) {
  const windows = userAgent.match(/Windows NT ([\d.]+)/);
  const android = userAgent.match(/Android ([\d.]+)/);
  const mac = userAgent.match(/Mac OS X ([\d_]+)/);
  if (windows) return `PC - Windows ${windows[1]}`;
  if (android) return `Mobile - Android ${android[1]}`;
  if (/iPhone/i.test(userAgent)) return 'Mobile - iPhone';
  if (mac) return `Mac - macOS ${mac[1].replace(/_/g, '.')}`;
  if (/Linux/i.test(userAgent)) return 'PC - Linux';
  return 'Unknown';
}
function clean(value, limit = 160) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, limit) || 'Unavailable';
}
function number(value, max = 100000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? Math.round(parsed) : null;
}
function clientContext(input, request) {
  const screenWidth = number(input.screenWidth), screenHeight = number(input.screenHeight);
  const viewportWidth = number(input.viewportWidth), viewportHeight = number(input.viewportHeight);
  return {
    language: clean(input.language || request.headers['accept-language']?.split(',')[0], 40),
    timezone: clean(input.timezone, 80),
    platform: clean(input.platform, 80),
    screen: screenWidth && screenHeight ? `${screenWidth} × ${screenHeight}` : 'Unavailable',
    viewport: viewportWidth && viewportHeight ? `${viewportWidth} × ${viewportHeight}` : 'Unavailable',
    colorScheme: clean(input.colorScheme, 20),
    touch: input.touch === true ? 'Touch' : input.touch === false ? 'Pointer' : 'Unavailable',
    clientNetwork: clean(input.clientNetwork, 60),
    referrer: clean(input.referrer, 300),
    page: clean(input.page, 180)
  };
}
function safePath(urlPath) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.resolve(root, `.${requested}`);
  return file.startsWith(root) ? file : null;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/keep-alive') return json(response, 200, {ok: true});
    if (request.method === 'POST' && url.pathname === '/api/visitors') {
      const input = await body(request);
      const visitors = readVisitors();
      const identity = String(input.id || crypto.randomUUID()).slice(0, 100);
      const ip = clientIp(request);
      const network = await lookupIp(ip);
      const now = new Date().toISOString();
      const previous = visitors.find(visitor => visitor.id === identity);
      const context = clientContext(input, request);
      const record = {
        id: identity, ip,
        country: request.headers['cf-ipcountry'] || request.headers['x-country'] || network.country,
        region: network.region, city: network.city, geoTimezone: network.timezone,
        isp: network.isp, asn: network.asn, vpn: network.vpn,
        browser: browser(request.headers['user-agent'] || ''), device: device(request.headers['user-agent'] || ''),
        userAgent: clean(request.headers['user-agent'], 500), ...context,
        firstSeen: previous?.firstSeen || now, lastSeen: now,
        visits: (previous?.visits || 0) + 1
      };
      const index = visitors.findIndex(visitor => visitor.id === identity);
      if (index >= 0) visitors[index] = {...visitors[index], ...record}; else visitors.push(record);
      writeVisitors(visitors);
      return json(response, 200, record);
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/login') {
      const input = await body(request);
      if (input.password !== adminPassword) return json(response, 401, {error: 'Incorrect password'});
      const token = crypto.randomBytes(32).toString('hex');
      sessions.add(token);
      return json(response, 200, {token});
    }
    if (request.method === 'GET' && url.pathname === '/api/visitors') {
      if (!authorized(request)) return json(response, 401, {error: 'Unauthorized'});
      return json(response, 200, readVisitors());
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/visitors/')) {
      if (!authorized(request)) return json(response, 401, {error: 'Unauthorized'});
      const id = decodeURIComponent(url.pathname.slice('/api/visitors/'.length));
      writeVisitors(readVisitors().filter(visitor => visitor.id !== id));
      return json(response, 200, {ok: true});
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, {error: 'Method not allowed'});
    const file = safePath(url.pathname);
    if (!file) return json(response, 403, {error: 'Forbidden'});
    fs.readFile(file, (error, content) => {
      if (error) return response.writeHead(404).end('Not found');
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
      response.writeHead(200, {'Content-Type': type});
      response.end(content);
    });
  } catch (error) {
    json(response, 400, {error: error.message || 'Request failed'});
  }
});

server.listen(port, () => console.log(`CATECOIN server listening on ${port}`));
