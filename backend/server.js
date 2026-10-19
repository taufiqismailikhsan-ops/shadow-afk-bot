'use strict';
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = {
  origin(origin, cb) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'));
  }
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '32kb' }));
const io = new Server(server, { cors: corsOptions, maxHttpBufferSize: 1e6 });

const API_TOKEN = process.env.API_TOKEN || '';
const settings = {
  host: process.env.MC_HOST || '',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'ShadowXBot',
  version: process.env.MC_VERSION || '1.21.11',
  auth: process.env.MC_AUTH === 'microsoft' ? 'microsoft' : 'offline',
  autoReconnect: process.env.AUTO_RECONNECT !== 'false',
  reconnectDelayMs: Math.max(3000, Number(process.env.RECONNECT_DELAY_MS || 10000)),
  antiAfk: process.env.ANTI_AFK === 'true'
};
let bot = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let manualStop = false;
let botState = 'offline';
let lastError = '';
let connectedAt = null;
const logs = [];

function log(message, type = 'info') {
  const entry = { time: new Date().toISOString(), type, message: String(message).slice(0, 500) };
  logs.push(entry); if (logs.length > 300) logs.shift();
  io.emit('log', entry);
  console.log(`[${entry.time}] [${type}] ${entry.message}`);
}
function snapshot() {
  return {
    state: botState,
    connected: Boolean(bot && bot.player && botState === 'online'),
    username: bot?.username || settings.username,
    host: settings.host,
    port: settings.port,
    version: settings.version,
    autoReconnect: settings.autoReconnect,
    reconnectDelayMs: settings.reconnectDelayMs,
    antiAfk: settings.antiAfk,
    reconnectAttempts,
    lastError,
    connectedAt,
    players: bot?.players ? Object.keys(bot.players).length : 0,
    health: bot?.health ?? null,
    food: bot?.food ?? null,
    position: bot?.entity?.position ? {
      x: Number(bot.entity.position.x.toFixed(1)),
      y: Number(bot.entity.position.y.toFixed(1)),
      z: Number(bot.entity.position.z.toFixed(1))
    } : null
  };
}
function broadcastStatus() { io.emit('status', snapshot()); }
function authorized(req) {
  const value = req.headers.authorization || '';
  return API_TOKEN && value === `Bearer ${API_TOKEN}`;
}
function requireAuth(req, res, next) {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized. Check the dashboard API token.' });
  next();
}
function scheduleReconnect() {
  if (manualStop || !settings.autoReconnect || reconnectTimer) return;
  botState = 'reconnecting'; broadcastStatus();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBot().catch(err => log(err.message, 'error'));
  }, settings.reconnectDelayMs);
  log(`Auto-reconnect scheduled in ${Math.round(settings.reconnectDelayMs / 1000)}s.`, 'warn');
}
async function connectBot() {
  if (!settings.host || !settings.username) throw new Error('Set Minecraft host and username in Settings first.');
  if (bot && bot._client && botState !== 'offline') return;
  manualStop = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  botState = 'connecting'; lastError = ''; broadcastStatus();
  log(`Connecting to ${settings.host}:${settings.port} as ${settings.username} (version ${settings.version || 'auto'})...`);
  let nextBot;
  try {
    const options = {
      host: settings.host,
      port: Number(settings.port),
      username: settings.username,
      version: settings.version === 'auto' ? false : settings.version,
      auth: settings.auth,
      hideErrors: false,
      checkTimeoutInterval: 60000
    };
    nextBot = mineflayer.createBot(options);
    bot = nextBot;
    nextBot.once('login', () => { botState = 'online'; connectedAt = new Date().toISOString(); reconnectAttempts = 0; log(`Logged in as ${nextBot.username}.`, 'success'); broadcastStatus(); });
    nextBot.on('spawn', () => { botState = 'online'; log('Spawned in the world.', 'success'); broadcastStatus(); });
    nextBot.on('kicked', reason => { lastError = typeof reason === 'string' ? reason : JSON.stringify(reason); log(`Kicked: ${lastError}`, 'error'); });
    nextBot.on('error', err => { lastError = err.message || String(err); log(`Bot error: ${lastError}`, 'error'); });
    nextBot.on('end', reason => {
      log(`Connection ended${reason ? `: ${reason}` : ''}.`, 'warn');
      if (bot === nextBot) bot = null;
      botState = 'offline'; connectedAt = null; broadcastStatus();
      if (!manualStop) { reconnectAttempts++; scheduleReconnect(); }
    });
    nextBot.on('chat', (username, message) => {
      log(`<${username}> ${message}`, 'chat');
      io.emit('chat', { time: new Date().toISOString(), username, message });
    });
    nextBot.on('message', jsonMsg => {
      const text = jsonMsg?.toString?.() || '';
      if (text) log(text, 'game');
    });
    nextBot.on('health', broadcastStatus);
    if (settings.antiAfk) startAntiAfk(nextBot);
  } catch (err) {
    bot = null; botState = 'offline'; lastError = err.message; log(`Could not connect: ${err.message}`, 'error'); broadcastStatus();
    if (!manualStop) { reconnectAttempts++; scheduleReconnect(); }
    throw err;
  }
}
function startAntiAfk(target) {
  // Small periodic head movement only; no movement or combat automation.
  const timer = setInterval(() => {
    if (bot !== target || botState !== 'online') { clearInterval(timer); return; }
    try { target.look(Math.random() * Math.PI * 2 - Math.PI, 0, true); } catch (_) {}
  }, 30000);
  target.once('end', () => clearInterval(timer));
}
function disconnectBot() {
  manualStop = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const oldBot = bot; bot = null; botState = 'offline'; connectedAt = null; broadcastStatus();
  if (oldBot) { try { oldBot.quit('ShadowX dashboard disconnect'); } catch (_) {} }
  log('Disconnected manually.');
}

app.get('/', (_req, res) => res.json({ name: 'ShadowX AFK Bot API', brand: 'by ShadowX', ok: true }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'shadowx-afk-backend' }));
app.use('/api', requireAuth);
app.get('/api/status', (_req, res) => res.json(snapshot()));
app.get('/api/logs', (_req, res) => res.json(logs.slice(-100)));
app.get('/api/config', (_req, res) => res.json({ ...settings, apiTokenConfigured: Boolean(API_TOKEN), auth: settings.auth }));
app.post('/api/connect', async (_req, res) => {
  try { await connectBot(); res.json({ ok: true, status: snapshot() }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/disconnect', (_req, res) => { disconnectBot(); res.json({ ok: true, status: snapshot() }); });
app.post('/api/chat', (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  if (message.length > 256) return res.status(400).json({ error: 'Message is too long (max 256 characters).' });
  if (!bot || botState !== 'online') return res.status(409).json({ error: 'Bot is not online.' });
  try { bot.chat(message); log(`[Dashboard] ${message}`, 'chat'); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/config', (req, res) => {
  const body = req.body || {};
  const host = String(body.host ?? settings.host).trim();
  const username = String(body.username ?? settings.username).trim();
  const port = Number(body.port ?? settings.port);
  const version = String(body.version ?? settings.version).trim() || 'auto';
  const auth = body.auth === 'microsoft' ? 'microsoft' : 'offline';
  const delay = Number(body.reconnectDelayMs ?? settings.reconnectDelayMs);
  if (!host) return res.status(400).json({ error: 'Minecraft host is required.' });
  if (!username || username.length > 16) return res.status(400).json({ error: 'Username must be 1–16 characters.' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: 'Port must be between 1 and 65535.' });
  if (!Number.isFinite(delay) || delay < 3000 || delay > 300000) return res.status(400).json({ error: 'Reconnect delay must be 3000–300000 ms.' });
  const connectionChanged = host !== settings.host || username !== settings.username || port !== settings.port || version !== settings.version || auth !== settings.auth;
  if (connectionChanged && bot && botState !== 'offline') return res.status(409).json({ error: 'Disconnect the bot before changing host, port, username, version, or authentication.' });
  Object.assign(settings, { host, username, port, version, auth, autoReconnect: body.autoReconnect === undefined ? settings.autoReconnect : body.autoReconnect === true, antiAfk: body.antiAfk === undefined ? settings.antiAfk : body.antiAfk === true, reconnectDelayMs: body.reconnectDelayMs === undefined ? settings.reconnectDelayMs : delay });
  log('Configuration updated from dashboard.'); broadcastStatus(); res.json({ ok: true, config: settings });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (API_TOKEN && token === API_TOKEN) return next();
  next(new Error('Unauthorized'));
});
io.on('connection', socket => {
  socket.emit('status', snapshot());
  socket.emit('logs:init', logs.slice(-100));
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  if (!API_TOKEN) log('WARNING: API_TOKEN is not set. Set a strong token before exposing this backend publicly.', 'error');
  log(`ShadowX AFK Bot backend listening on port ${port}.`);
});
process.on('SIGINT', () => { disconnectBot(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { disconnectBot(); server.close(() => process.exit(0)); });
