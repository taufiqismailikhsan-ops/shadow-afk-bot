(() => {
  const $ = id => document.getElementById(id);
  const defaults = { backendUrl: '', apiToken: '', host: '', port: 25565, username: 'ShadowXBot', version: '1.21.11', auth: 'offline', reconnectDelayMs: 10000, autoReconnect: true, antiAfk: false };
  let config = { ...defaults, ...loadSaved() };
  let socket = null, poller = null, startedAt = null, logs = [], toastTimer;
  function loadSaved() { try { return JSON.parse(localStorage.getItem('shadowx-settings') || '{}'); } catch { return {}; } }
  function saveLocal() { localStorage.setItem('shadowx-settings', JSON.stringify(config)); }
  function apiUrl(path) { return config.backendUrl.replace(/\/+$/, '') + path; }
  function headers(json = true) { const h = { Authorization: `Bearer ${config.apiToken}` }; if (json) h['Content-Type'] = 'application/json'; return h; }
  async function request(path, options = {}) {
    if (!config.backendUrl || !config.apiToken) throw new Error('Set the backend URL and API token in Settings first.');
    let response;
    try { response = await fetch(apiUrl(path), { ...options, headers: { ...headers(), ...(options.headers || {}) } }); }
    catch { throw new Error('Could not reach backend. Check its URL, server status, and CORS settings.'); }
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000); }
  function setApiState(connected) { $('apiState').classList.toggle('connected', connected); $('apiState').innerHTML = `<i></i> ${connected ? 'Backend connected' : 'Backend disconnected'}`; }
  function addLog(entry) {
    if (!entry) return;
    logs.push(entry); if (logs.length > 500) logs.shift();
    const box = $('console'); if (box.querySelector('.console-placeholder')) box.innerHTML = '';
    const row = document.createElement('div'); row.className = `log-line ${safeType(entry.type)}`;
    const date = new Date(entry.time || Date.now());
    const time = document.createElement('span'); time.className = 'log-time'; time.textContent = date.toLocaleTimeString([], { hour12: false });
    const type = document.createElement('span'); type.className = 'log-type'; type.textContent = safeType(entry.type);
    const message = document.createElement('span'); message.className = 'log-message'; message.textContent = String(entry.message || '').slice(0, 500);
    row.append(time, type, message); box.appendChild(row); box.scrollTop = box.scrollHeight;
  }
  function safeType(value) { return ['info','error','warn','success','chat','game'].includes(value) ? value : 'info'; }
  function replaceLogs(items) { logs = []; $('console').innerHTML = ''; (items || []).forEach(addLog); if (!items?.length) $('console').innerHTML = '<div class="console-placeholder">No log entries yet.</div>'; }
  function setStatus(s = {}) {
    const state = String(s.state || 'offline').toLowerCase(); $('botState').textContent = state.toUpperCase();
    $('statusLight').style.background = state === 'online' ? 'var(--green)' : state === 'connecting' || state === 'reconnecting' ? 'var(--amber)' : 'var(--red)';
    $('statusDetail').textContent = s.lastError ? `Last error: ${s.lastError}` : state === 'online' ? `Connected as ${s.username || config.username}` : state === 'connecting' ? 'Connecting to Minecraft server…' : state === 'reconnecting' ? 'Waiting before reconnect attempt…' : 'Bot is currently offline.';
    $('serverName').textContent = s.host ? `${s.host}:${s.port || 25565}` : 'Not configured'; $('serverVersion').textContent = `Version: ${s.version || '—'}`;
    $('reconnectInfo').textContent = s.autoReconnect ? `Auto-reconnect · ${Math.round((s.reconnectDelayMs || 10000)/1000)}s delay` : 'Auto-reconnect disabled';
    $('reconnects').textContent = s.reconnectAttempts ?? 0; $('players').textContent = s.players ?? '—'; $('playerInfo').textContent = `Players: ${s.players ?? '—'}`;
    $('health').textContent = s.health == null ? '—' : Math.round(s.health); $('food').textContent = s.food == null ? '—' : Math.round(s.food);
    $('position').textContent = s.position ? `X ${s.position.x}   Y ${s.position.y}   Z ${s.position.z}` : 'X —   Y —   Z —';
    $('quickReconnect').checked = Boolean(s.autoReconnect); $('quickAntiAfk').checked = Boolean(s.antiAfk);
    startedAt = s.connectedAt ? new Date(s.connectedAt).getTime() : null; $('sessionSince').textContent = startedAt ? `Since ${new Date(startedAt).toLocaleTimeString()}` : 'No active session';
    $('botOrb').style.color = state === 'online' ? 'var(--green)' : '#b5a2ff';
    $('connectBtn').disabled = ['online','connecting'].includes(state); $('disconnectBtn').disabled = state === 'offline';
  }
  function renderUptime() {
    if (!startedAt) { $('uptime').textContent = '—'; return; }
    let secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000)); const h = Math.floor(secs / 3600); secs %= 3600; const m = Math.floor(secs / 60); const s = secs % 60;
    $('uptime').textContent = h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
  }
  function openSettings() {
    $('backendUrl').value = config.backendUrl; $('apiToken').value = config.apiToken; $('mcHost').value = config.host; $('mcPort').value = config.port;
    $('mcUsername').value = config.username; $('mcVersion').value = config.version; $('mcAuth').value = config.auth;
    $('reconnectDelay').value = config.reconnectDelayMs; $('cfgReconnect').checked = config.autoReconnect; $('cfgAntiAfk').checked = config.antiAfk;
    $('settingsNote').textContent = ''; $('settingsModal').classList.remove('hidden');
  }
  function closeSettings() { $('settingsModal').classList.add('hidden'); }
  async function testBackend() {
    const old = { ...config };
    config.backendUrl = $('backendUrl').value.trim().replace(/\/+$/, ''); config.apiToken = $('apiToken').value.trim();
    try { const status = await request('/api/status'); setApiState(true); setStatus(status); $('settingsNote').textContent = 'Backend reachable and token accepted.'; toast('Backend connection successful.'); }
    catch (err) { config = old; $('settingsNote').textContent = err.message; toast(err.message); }
  }
  function connectSocket() {
    if (socket) { socket.disconnect(); socket = null; }
    if (!window.io || !config.backendUrl || !config.apiToken) return;
    try {
      socket = window.io(config.backendUrl.replace(/\/+$/, ''), { auth: { token: config.apiToken }, transports: ['websocket','polling'], reconnection: true, reconnectionDelay: 3000 });
      socket.on('connect', () => setApiState(true)); socket.on('disconnect', () => setApiState(false)); socket.on('connect_error', () => setApiState(false));
      socket.on('status', setStatus); socket.on('log', addLog); socket.on('logs:init', replaceLogs);
      socket.on('chat', item => addLog({ ...item, type: 'chat', message: `<${item.username}> ${item.message}` }));
    } catch { setApiState(false); }
  }
  async function refresh() {
    try { const status = await request('/api/status'); setApiState(true); setStatus(status); }
    catch { setApiState(false); }
  }
  async function loadInitial() {
    if (!config.backendUrl || !config.apiToken) { setApiState(false); openSettings(); return; }
    try { const [status, logData, serverConfig] = await Promise.all([request('/api/status'), request('/api/logs'), request('/api/config')]); setApiState(true); setStatus(status); replaceLogs(logData); config = { ...config, host: serverConfig.host || config.host, port: serverConfig.port || config.port, username: serverConfig.username || config.username, version: serverConfig.version || config.version, auth: serverConfig.auth || config.auth, autoReconnect: serverConfig.autoReconnect, reconnectDelayMs: serverConfig.reconnectDelayMs || config.reconnectDelayMs, antiAfk: Boolean(serverConfig.antiAfk) }; saveLocal(); connectSocket(); }
    catch (err) { setApiState(false); if (!logs.length) addLog({ type: 'warn', message: err.message, time: new Date().toISOString() }); openSettings(); }
  }
  $('openSettings').addEventListener('click', openSettings); $('editConfig').addEventListener('click', openSettings); $('closeSettings').addEventListener('click', closeSettings);
  $('settingsModal').addEventListener('click', e => { if (e.target === $('settingsModal')) closeSettings(); });
  $('testBackend').addEventListener('click', testBackend);
  $('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const newConfig = {
      backendUrl: $('backendUrl').value.trim().replace(/\/+$/, ''), apiToken: $('apiToken').value.trim(),
      host: $('mcHost').value.trim(), port: Number($('mcPort').value), username: $('mcUsername').value.trim(),
      version: $('mcVersion').value.trim() || 'auto', auth: $('mcAuth').value, reconnectDelayMs: Number($('reconnectDelay').value),
      autoReconnect: $('cfgReconnect').checked, antiAfk: $('cfgAntiAfk').checked
    };
    if (!newConfig.backendUrl || !newConfig.apiToken) { $('settingsNote').textContent = 'Backend URL and API token are required.'; return; }
    const previous = config; config = newConfig;
    try {
      const data = await request('/api/config', { method: 'PUT', body: JSON.stringify({ host: config.host, port: config.port, username: config.username, version: config.version, auth: config.auth, reconnectDelayMs: config.reconnectDelayMs, autoReconnect: config.autoReconnect, antiAfk: config.antiAfk }) });
      saveLocal(); setStatus({ ...data.config, state: 'offline' }); connectSocket(); await refresh(); closeSettings(); toast('Settings saved.');
    } catch (err) { config = previous; $('settingsNote').textContent = err.message; toast(err.message); }
  });
  $('connectBtn').addEventListener('click', async () => { try { await request('/api/connect', { method: 'POST', body: '{}' }); toast('Connect request sent.'); await refresh(); } catch (err) { toast(err.message); addLog({ type: 'error', message: err.message, time: new Date().toISOString() }); } });
  $('disconnectBtn').addEventListener('click', async () => { try { await request('/api/disconnect', { method: 'POST', body: '{}' }); toast('Disconnect request sent.'); await refresh(); } catch (err) { toast(err.message); } });
  $('chatForm').addEventListener('submit', async e => { e.preventDefault(); const input = $('chatInput'); const message = input.value.trim(); if (!message) return; try { await request('/api/chat', { method: 'POST', body: JSON.stringify({ message }) }); input.value = ''; } catch (err) { toast(err.message); } });
  $('quickReconnect').addEventListener('change', async e => { config.autoReconnect = e.target.checked; try { await request('/api/config', { method: 'PUT', body: JSON.stringify({ autoReconnect: config.autoReconnect }) }); saveLocal(); toast('Auto-reconnect updated.'); await refresh(); } catch (err) { e.target.checked = !e.target.checked; config.autoReconnect = e.target.checked; toast(err.message); } });
  $('quickAntiAfk').addEventListener('change', async e => { config.antiAfk = e.target.checked; try { await request('/api/config', { method: 'PUT', body: JSON.stringify({ antiAfk: config.antiAfk }) }); saveLocal(); toast('Anti-AFK setting updated.'); await refresh(); } catch (err) { e.target.checked = !e.target.checked; config.antiAfk = e.target.checked; toast(err.message); } });
  $('clearLogs').addEventListener('click', () => { logs = []; $('console').innerHTML = '<div class="console-placeholder">Console cleared in this view.</div>'; });
  $('downloadLogs').addEventListener('click', () => { const text = logs.map(x => `[${x.time || ''}] [${x.type || 'info'}] ${x.message || ''}`).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'shadowx-afk-console.txt'; a.click(); URL.revokeObjectURL(a.href); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });
  setInterval(renderUptime, 1000); setInterval(() => { if (!socket?.connected) refresh(); }, 7000);
  loadInitial();
})();
