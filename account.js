/* Konto, Freunde, Live-Status und News – alles über Supabase (Free-Tier) per einfacher REST-Schnittstelle, ohne zusätzliche Pakete.
   Zugangsdaten stehen in backend.json (Projekt-URL und "anon"-Schlüssel; der anon-Schlüssel ist öffentlich gedacht, der Schutz kommt von den RLS-Regeln in supabase/setup.sql). */
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const GOOGLE_PORT = 4799;

module.exports = function createAccount({ app, shell, safeStorage, log, onChange }) {
  let B = { supabaseUrl: '', supabaseAnonKey: '', newsUrl: '' };
  for (const f of [path.join(__dirname, 'backend.json'), path.join(app.getPath('userData'), 'backend.json')]) {
    try { Object.assign(B, JSON.parse(fs.readFileSync(f, 'utf8'))); } catch {}
  }
  B.supabaseUrl = String(B.supabaseUrl || '').replace(/\/+$/, '');
  const configured = /^https:\/\/.+\.supabase\.co$/i.test(B.supabaseUrl) && String(B.supabaseAnonKey || '').length > 20;
  const FILE = path.join(app.getPath('userData'), 'session.bin');
  let lastDay = '', session = null, profile = null, activity = null, shareAct = true, hb = 0, lastSent = '';

  /* ---------- Sitzung sicher speichern ---------- */
  function persist() {
    try {
      if (!session) { fs.rmSync(FILE, { force: true }); return; }
      const raw = JSON.stringify(session);
      fs.writeFileSync(FILE, safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(raw) : Buffer.from(raw), { mode: 0o600 });
    } catch (e) { log(e); }
  }
  function restore() {
    try {
      const buf = fs.readFileSync(FILE);
      const raw = safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString();
      session = JSON.parse(raw);
    } catch { session = null; }
  }

  /* ---------- HTTP ---------- */
  async function raw(method, p, { body, query, token, headers } = {}) {
    const url = B.supabaseUrl + p + (query ? '?' + query : '');
    const r = await fetch(url, { method, signal: AbortSignal.timeout(12000), body: body ? JSON.stringify(body) : undefined,
      headers: Object.assign({ apikey: B.supabaseAnonKey, Authorization: 'Bearer ' + (token || B.supabaseAnonKey), 'Content-Type': 'application/json' }, headers || {}) });
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
    return { ok: r.ok, status: r.status, json: j };
  }
  async function refresh() {
    if (!session || !session.refresh_token) return false;
    const r = await raw('POST', '/auth/v1/token', { query: 'grant_type=refresh_token', body: { refresh_token: session.refresh_token } });
    if (r.ok && r.json && r.json.access_token) { setSession(r.json); return true; }
    if (r.status === 400 || r.status === 401) { session = null; profile = null; persist(); onChange(); }
    return false;
  }
  function setSession(j) {
    session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, email: j.user.email } };
    persist();
  }
  async function api(method, p, opt = {}) {
    if (session && session.expires_at - Date.now() / 1000 < 60) await refresh();
    let r = await raw(method, p, Object.assign({ token: session && session.access_token }, opt));
    if (r.status === 401 && session && await refresh()) r = await raw(method, p, Object.assign({ token: session.access_token }, opt));
    return r;
  }
  const errText = r => (r.json && (r.json.msg || r.json.message || r.json.error_description || r.json.error)) || ('HTTP ' + r.status);
  const cleanName = s => String(s || '').trim().toLowerCase();
  const validName = s => /^[a-z0-9_]{3,20}$/.test(s);

  /* ---------- Zustand ---------- */
  const state = () => ({ configured, signedIn: !!session, user: session ? session.user : null, username: profile ? profile.username : null, needsUsername: !!session && !profile });
  async function loadProfile() {
    profile = null; if (!session) return;
    const r = await api('GET', '/rest/v1/profiles', { query: `id=eq.${session.user.id}&select=username` });
    if (r.ok && r.json && r.json[0]) profile = { username: r.json[0].username };
  }
  async function init() {
    if (!configured) return;
    restore(); if (session) { if (session.expires_at - Date.now() / 1000 < 60) await refresh(); await loadProfile(); onChange(); beat(); }
    clearInterval(hb); hb = setInterval(() => { if (session && profile) push(true); }, 40000);
  }
  async function afterLogin() { await loadProfile(); onChange(); await push(true); return state(); }

  /* ---------- Registrieren / Anmelden ---------- */
  async function usernameFree(n) {
    const r = await raw('POST', '/rest/v1/rpc/username_free', { body: { name: n } });
    return r.ok ? r.json === true : true;
  }
  async function signUp({ email, password, username }) {
    if (!configured) return { error: 'nobackend' };
    username = cleanName(username);
    if (!validName(username)) return { error: 'badname' };
    if (String(password || '').length < 6) return { error: 'short' };
    if (!(await usernameFree(username))) return { error: 'taken' };
    const r = await raw('POST', '/auth/v1/signup', { body: { email: String(email).trim(), password, data: { username } } });
    if (!r.ok) return { error: /registered|already/i.test(errText(r)) ? 'exists' : 'err', detail: errText(r) };
    if (r.json && r.json.access_token) { setSession(r.json); return { ok: true, state: await afterLogin() }; }
    return { ok: true, confirm: true };
  }
  async function signIn({ email, password }) {
    if (!configured) return { error: 'nobackend' };
    const r = await raw('POST', '/auth/v1/token', { query: 'grant_type=password', body: { email: String(email).trim(), password } });
    if (!r.ok) return { error: r.status === 400 ? (/confirm/i.test(errText(r)) ? 'unconfirmed' : 'wrong') : 'err', detail: errText(r) };
    setSession(r.json); return { ok: true, state: await afterLogin() };
  }
  /* Google: Anmeldung im Standard-Browser (Google erlaubt keine eingebetteten Fenster), Rückkehr über einen kurzen lokalen Server (PKCE) */
  function google() {
    if (!configured) return Promise.resolve({ error: 'nobackend' });
    return new Promise(resolve => {
      const verifier = crypto.randomBytes(48).toString('base64url'), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      let done = false, srv;
      const finish = v => { if (done) return; done = true; try { srv.close(); } catch {} resolve(v); };
      srv = http.createServer(async (req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
        const code = u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><body style="font:20px system-ui;background:#111;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><div id="m"></div><script>const M={"en": "Done – you can close this window and return to Lounge.", "de": "Fertig – du kannst dieses Fenster schließen und zu Lounge zurückkehren.", "es": "Listo: puedes cerrar esta ventana y volver a Lounge.", "fr": "Terminé : vous pouvez fermer cette fenêtre et revenir à Lounge.", "it": "Fatto: puoi chiudere questa finestra e tornare a Lounge.", "pt": "Concluído – pode fechar esta janela e voltar ao Lounge.", "nl": "Klaar – je kunt dit venster sluiten en teruggaan naar Lounge.", "pl": "Gotowe – możesz zamknąć to okno i wrócić do Lounge.", "tr": "Tamam – bu pencereyi kapatıp Lounge’a dönebilirsin.", "ru": "Готово – можно закрыть это окно и вернуться в Lounge.", "ja": "完了しました。このウィンドウを閉じて Lounge に戻ってください。", "zh": "完成 – 你可以关闭此窗口并返回 Lounge。", "ko": "완료 – 이 창을 닫고 Lounge로 돌아가세요.", "ar": "تم – يمكنك إغلاق هذه النافذة والعودة إلى Lounge."},l=(navigator.language||"en").toLowerCase().split(/[-_]/)[0];document.documentElement.dir=l==="ar"?"rtl":"ltr";document.getElementById("m").textContent=M[l]||M.en;</script>');
        if (!code) return finish({ error: 'err' });
        const r = await raw('POST', '/auth/v1/token', { query: 'grant_type=pkce', body: { auth_code: code, code_verifier: verifier } });
        if (!r.ok) return finish({ error: 'err', detail: errText(r) });
        setSession(r.json); finish({ ok: true, state: await afterLogin() });
      });
      srv.on('error', () => finish({ error: 'err' }));
      srv.listen(GOOGLE_PORT, '127.0.0.1', () => {
        const q = new URLSearchParams({ provider: 'google', redirect_to: `http://127.0.0.1:${GOOGLE_PORT}/callback`, flow_type: 'pkce', code_challenge: challenge, code_challenge_method: 's256' });
        shell.openExternal(`${B.supabaseUrl}/auth/v1/authorize?${q}`);
      });
      setTimeout(() => finish({ error: 'timeout' }), 180000);
    });
  }
  async function setUsername(name) {
    name = cleanName(name); if (!session) return { error: 'err' };
    if (!validName(name)) return { error: 'badname' };
    const r = await api('POST', '/rest/v1/profiles', { body: { id: session.user.id, username: name }, headers: { Prefer: 'return=minimal' } });
    if (r.status === 409) return { error: 'taken' };
    if (!r.ok) return { error: 'err', detail: errText(r) };
    await loadProfile(); onChange(); await push(true); return { ok: true, state: state() };
  }
  async function signOut() {
    if (session) { try { await api('DELETE', '/rest/v1/presence', { query: `user_id=eq.${session.user.id}` }); } catch {} try { await api('POST', '/auth/v1/logout', {}); } catch {} }
    session = null; profile = null; persist(); onChange(); return state();
  }

  /* ---------- Live-Status ---------- */
  function setActivity(a, share) { activity = a || null; shareAct = share !== false; push(false); }
  async function push(force) {
    if (!configured || !session || !profile) return;
    const act = shareAct ? activity : null, key = String(act);
    if (!force && key === lastSent) return; lastSent = key;
    const day = new Date().toISOString().slice(0, 10);
    if (day !== lastDay) { lastDay = day; try { await api('POST', '/rest/v1/daily_active', { query: 'on_conflict=user_id,day', body: { user_id: session.user.id, day }, headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } }); } catch {} }
    try { await api('POST', '/rest/v1/presence', { query: 'on_conflict=user_id', body: { user_id: session.user.id, activity: act, updated_at: new Date().toISOString() }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }); } catch {}
  }
  const beat = () => push(true);
  async function goOffline() { if (session) try { await api('DELETE', '/rest/v1/presence', { query: `user_id=eq.${session.user.id}` }); } catch {} }

  /* ---------- Freunde ---------- */
  async function friends() {
    if (!configured || !session) return { signedIn: false };
    const me = session.user.id;
    const r = await api('GET', '/rest/v1/friendships', { query: `select=id,requester,addressee,status&or=(requester.eq.${me},addressee.eq.${me})` });
    if (!r.ok) return { signedIn: true, error: 'err' };
    const rows = r.json || [], ids = [...new Set(rows.map(x => x.requester === me ? x.addressee : x.requester))];
    let names = {}, pres = {};
    if (ids.length) {
      const list = ids.join(',');
      const [p, s] = await Promise.all([api('GET', '/rest/v1/profiles', { query: `id=in.(${list})&select=id,username` }), api('GET', '/rest/v1/presence', { query: `user_id=in.(${list})&select=user_id,activity,updated_at` })]);
      (p.json || []).forEach(x => { names[x.id] = x.username; }); (s.json || []).forEach(x => { pres[x.user_id] = x; });
    }
    const out = { signedIn: true, friends: [], incoming: [], outgoing: [] };
    for (const x of rows) {
      const other = x.requester === me ? x.addressee : x.requester, name = names[other] || '?';
      if (x.status === 'accepted') {
        const pr = pres[other], online = !!pr && Date.now() - new Date(pr.updated_at).getTime() < 100000;
        out.friends.push({ fid: x.id, id: other, username: name, online, activity: online ? pr.activity : null });
      } else if (x.addressee === me) out.incoming.push({ fid: x.id, username: name });
      else out.outgoing.push({ fid: x.id, username: name });
    }
    out.friends.sort((a, b) => (b.online - a.online) || a.username.localeCompare(b.username));
    return out;
  }
  async function search(q) {
    q = cleanName(q).replace(/[^a-z0-9_]/g, ''); if (!q || !session) return [];
    const r = await api('GET', '/rest/v1/profiles', { query: `username=ilike.${q}*&select=id,username&limit=8` });
    return (r.json || []).filter(x => x.id !== session.user.id);
  }
  async function add(username) {
    if (!session) return { error: 'err' };
    const n = cleanName(username), pr = await api('GET', '/rest/v1/profiles', { query: `username=eq.${n}&select=id` });
    const to = pr.json && pr.json[0]; if (!to) return { error: 'nouser' };
    if (to.id === session.user.id) return { error: 'me' };
    /* Hat die andere Person uns schon eine Anfrage geschickt, wird sie einfach angenommen */
    const ex = await api('GET', '/rest/v1/friendships', { query: `requester=eq.${to.id}&addressee=eq.${session.user.id}&select=id` });
    if (ex.json && ex.json[0]) return accept(ex.json[0].id);
    const r = await api('POST', '/rest/v1/friendships', { body: { requester: session.user.id, addressee: to.id }, headers: { Prefer: 'return=minimal' } });
    if (r.status === 409) return { ok: true, already: true };
    return r.ok ? { ok: true } : { error: 'err', detail: errText(r) };
  }
  async function accept(fid) { const r = await api('PATCH', '/rest/v1/friendships', { query: `id=eq.${fid}`, body: { status: 'accepted' }, headers: { Prefer: 'return=minimal' } }); return r.ok ? { ok: true } : { error: 'err' }; }
  async function remove(fid) { const r = await api('DELETE', '/rest/v1/friendships', { query: `id=eq.${fid}` }); return r.ok ? { ok: true } : { error: 'err' }; }

  /* ---------- News ---------- */
  const NEWS_CACHE = path.join(app.getPath('userData'), 'news-cache.json');
  async function news() {
    let list = null;
    try {
      if (configured) { const r = await raw('GET', '/rest/v1/news', { query: 'select=id,title,tag,summary,body,image_url,created_at&published=eq.true&order=created_at.desc&limit=10' }); if (r.ok && Array.isArray(r.json)) list = r.json; }
      else if (B.newsUrl) { const r = await fetch(B.newsUrl, { signal: AbortSignal.timeout(8000) }); if (r.ok) list = await r.json(); }
    } catch {}
    if (list && list.length) { try { fs.writeFileSync(NEWS_CACHE, JSON.stringify(list)); } catch {} return list; }
    try { return JSON.parse(fs.readFileSync(NEWS_CACHE, 'utf8')); } catch {}
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'renderer', 'news.json'), 'utf8')); } catch {}
    return [];
  }

  return { init, state, signUp, signIn, google, setUsername, signOut, setActivity, goOffline, friends, search, add, accept, remove, news, configured };
};
