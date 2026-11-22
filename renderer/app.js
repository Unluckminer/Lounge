const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let cfg = { apps: [], quick: [], running: [], lang: 'en', theme: 'system', accent: '#0a84ff', h24: true, walls: [], defWalls: [], slide: true, slideSec: 20, wallDefaults: true, fontScale: 1, widgets: null, ctrlL: true },
  editing = false, wxd = null, calKey = '', modalEl = null, modalId = null, prevFocus = null, AC = null, selW = null;
const T = k => I18N.t(cfg.lang, k);
const ACCENTS = ['#0a84ff', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#40c8e0', '#ffd60a', '#ac8e68'];
const mq = matchMedia('(prefers-color-scheme: dark)');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Darstellung ---------- */
const colorOf = a => a.color ? `rgb(${a.color.join(',')})` : `hsl(${Math.abs([...a.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 360} 50% 45%)`;
const idleBg = () => [cfg.accent, `color-mix(in srgb, ${cfg.accent} 45%, #6a3cff)`];
function setBg(c1, c2) { const s = document.documentElement.style; s.setProperty('--c1', c1); s.setProperty('--c2', c2 || `color-mix(in srgb, ${c1} 40%, #5a3cff)`); }
function applyTheme() {
  const r = document.documentElement, dark = cfg.theme === 'system' ? mq.matches : cfg.theme === 'dark';
  r.dataset.theme = dark ? 'dark' : 'light';
  r.style.setProperty('--accent', cfg.accent); r.style.setProperty('--ar', [1, 3, 5].map(i => parseInt(cfg.accent.slice(i, i + 2), 16)).join(','));
  r.style.setProperty('--fs', cfg.fontScale || 1);
  document.body.classList.toggle('still', !cfg.calm);
  if (!document.activeElement?.closest?.('.tile:not(.add)')) setBg(...idleBg());
  window.Liquid && Liquid.refresh();
}
function applyLang() {
  const r = document.documentElement; r.lang = cfg.lang; r.dir = I18N.dir(cfg.lang);
  $$('[data-i]').forEach(e => { e.textContent = T(e.dataset.i); });
  $('#gear').setAttribute('aria-label', T('settings')); $('#wheel').setAttribute('aria-label', T('wheel'));
  renderProfile(); $('#friendsBtn .bd').hidden = !(FR && FR.incoming && FR.incoming.length);
  $('#editHint').textContent = T('editHint'); $('#eAdd').textContent = '+ ' + T('addWidget'); $('#eReset').textContent = T('resetLayout'); $('#eDone').textContent = T('done');
  renderZone(); weather(); render(); renderQuick(); pill();
}
mq.addEventListener('change', applyTheme);

/* ---------- Diashow (Hintergrund, angelehnt an die Apple-TV-Bildschirmschoner) ----------
   Zufällige Reihenfolge ohne Wiederholung, langsame Kamerafahrt (Zoom + Schwenk) und ruhige Überblendung.
   Die Kamerafahrt läuft über die Überblendung hinaus weiter, damit nichts ruckt oder stehen bleibt. */
const FADE_MS = 2600;
let slideT = 0, slideList = [], slideOrder = [], slideIdx = 0, slideFront = 0, slideGen = 0;
const wallSources = () => [...(cfg.walls || []), ...(cfg.wallDefaults !== false ? (cfg.defWalls || []) : [])];
const shuffled = n => { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function kenburns(el, ms) {
  el.getAnimations().forEach(a => a.cancel());
  if (!cfg.calm || reduce) { el.style.transform = 'scale(1.04)'; return; }
  const zin = Math.random() < .62, z0 = zin ? 1.03 : 1.15, z1 = zin ? 1.15 : 1.03, r = () => (Math.random() * 2 - 1);
  const x0 = r() * 2.2, y0 = r() * 1.6, x1 = -x0 + r() * 1.2, y1 = -y0 + r() * .9;
  el.animate([{ transform: `translate(${x0}%, ${y0}%) scale(${z0})` }, { transform: `translate(${x1}%, ${y1}%) scale(${z1})` }], { duration: ms + FADE_MS * 2, easing: 'linear', fill: 'forwards' });
}
async function showWall(url, instant) {
  const gen = ++slideGen, els = [$('#wall'), $('#wall2')], nxt = els[1 - slideFront], cur = els[slideFront];
  const img = new Image(); img.src = url;
  try { await img.decode(); } catch { if (gen === slideGen && slideList.length > 1) setTimeout(nextWall, 400); return; }
  if (gen !== slideGen) return;
  nxt.style.transitionDuration = instant ? '.9s' : '';
  nxt.style.backgroundImage = `url("${url}")`;
  kenburns(nxt, (cfg.slideSec || 20) * 1000);
  nxt.classList.add('on'); cur.classList.remove('on'); slideFront = 1 - slideFront;
}
function nextWall() {
  if (slideList.length < 2) return;
  slideIdx = (slideIdx + 1) % slideOrder.length; showWall(slideList[slideOrder[slideIdx]]);
  const nn = new Image(); nn.src = slideList[slideOrder[(slideIdx + 1) % slideOrder.length]];   // nächstes Bild schon vorladen
}
function wallStart() {
  clearInterval(slideT);
  const list = wallSources(), same = JSON.stringify(list) === JSON.stringify(slideList);
  document.body.classList.toggle('has-wall', list.length > 0); document.body.classList.toggle('no-wall', !list.length);
  slideList = list;
  if (!list.length) { $$('.wl').forEach(e => { e.classList.remove('on'); e.style.backgroundImage = 'none'; }); return; }
  if (!same || !$('.wl.on')) { slideOrder = cfg.slide ? shuffled(list.length) : list.map((_, i) => i); slideIdx = 0; showWall(list[slideOrder[0]], true); }
  else if (!cfg.slide) { slideOrder = list.map((_, i) => i); slideIdx = 0; showWall(list[0], true); }
  else kenburns($$('.wl')[slideFront], (cfg.slideSec || 20) * 1000);
  if (cfg.slide && list.length > 1) slideT = setInterval(nextWall, (cfg.slideSec || 20) * 1000);
}

/* ---------- Widgets (alle weiß, Größe frei veränderbar) ---------- */
/* w/h = Größe in Prozent der Bildschirmbreite/-höhe, rw/rh = Bezugsgröße in px, nach der sich der Inhalt mitskaliert */
const WT = {
  greet:     { w: 28, h: 9,  rw: 400, rh: 64,  k: 'wGreet', plain: true },
  time:      { w: 28, h: 26, rw: 400, rh: 200, k: 'wTime', plain: true },
  date:      { w: 28, h: 9,  rw: 400, rh: 56,  k: 'wDate', plain: true },
  weather:   { w: 17, h: 33, rw: 250, rh: 265, k: 'wWeather' },
  forecast:  { w: 30, h: 26, rw: 440, rh: 195, k: 'wForecast' },
  calendar:  { w: 18, h: 48, rw: 280, rh: 330, k: 'wCal' },
  note:      { w: 17, h: 38, rw: 250, rh: 270, k: 'wNote' },
  todo:      { w: 17, h: 44, rw: 250, rh: 300, k: 'wTodo' },
  timer:     { w: 17, h: 40, rw: 250, rh: 260, k: 'wTimer' },
  world:     { w: 13, h: 25, rw: 200, rh: 170, k: 'wWorld' },
  system:    { w: 16, h: 34, rw: 245, rh: 250, k: 'wSystem' },
  countdown: { w: 15, h: 33, rw: 225, rh: 235, k: 'wCountdown' },
};
const defaultWidgets = () => [
  { id: 'greet', type: 'greet', x: 3, y: 4, w: 28, h: 9 }, { id: 'time', type: 'time', x: 3, y: 13, w: 28, h: 26 }, { id: 'date', type: 'date', x: 3, y: 39, w: 28, h: 9 },
  { id: 'forecast', type: 'forecast', x: 3, y: 56, w: 30, h: 24 },
  { id: 'weather', type: 'weather', x: 60, y: 11, w: 17, h: 33 }, { id: 'calendar', type: 'calendar', x: 79, y: 11, w: 18, h: 46 },
];
const widgets = () => cfg.widgets || defaultWidgets();
const wById = id => widgets().find(w => w.id === id);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const commit = () => { if (!cfg.widgets) cfg.widgets = defaultWidgets(); return save({ widgets: cfg.widgets }); };
let commitT = 0; const commitSoon = () => { clearTimeout(commitT); commitT = setTimeout(commit, 400); };
const RT = {};   // Laufzeitdaten (Timer usw.)
const ro = new ResizeObserver(es => es.forEach(e => { const el = e.target, t = WT[el.dataset.type]; if (!t) return; el.style.setProperty('--u', clamp(Math.min(e.contentRect.width / t.rw, e.contentRect.height / t.rh), .45, 6).toFixed(3)); }));
function place(el, w) { el.style.left = w.x + '%'; el.style.top = w.y + '%'; el.style.width = w.w + '%'; el.style.height = w.h + '%'; }
function fit(el, w) {
  w.w = clamp(w.w, 4, 100); w.h = clamp(w.h, 4, 100);
  w.x = clamp(w.x, 0, 100 - w.w); w.y = clamp(w.y, 0, 100 - w.h); place(el, w);
}
const ICO = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  part: '<circle cx="8.2" cy="8.2" r="2.9"/><path d="M8.2 2.6v1.3M2.6 8.2h1.3M4.2 4.2l.9.9M12.2 4.2l-.9.9"/><path d="M8.5 19.5h8.6a3.6 3.6 0 0 0 .5-7.2 5.3 5.3 0 0 0-10 1.4 3 3 0 0 0 .9 5.8z"/>',
  cloud: '<path d="M7 18.5h10.2a4.2 4.2 0 0 0 .6-8.4A6.2 6.2 0 0 0 5.9 11.5 3.6 3.6 0 0 0 7 18.5z"/>',
  fog: '<path d="M6.5 12.5h11a3.6 3.6 0 0 0 .3-7.1A5.3 5.3 0 0 0 7.9 6.6 3.2 3.2 0 0 0 6.5 12.5z"/><path d="M4 16h16M7 19.5h10"/>',
  drizzle: '<path d="M7 14.5h10.2a4.2 4.2 0 0 0 .6-8.4A6.2 6.2 0 0 0 5.9 7.5 3.6 3.6 0 0 0 7 14.5z"/><path d="M9 18l-.6 1.6M13 18l-.6 1.6M17 18l-.6 1.6"/>',
  rain: '<path d="M7 14.5h10.2a4.2 4.2 0 0 0 .6-8.4A6.2 6.2 0 0 0 5.9 7.5 3.6 3.6 0 0 0 7 14.5z"/><path d="M8.5 17.5l-1.2 3.2M12.5 17.5l-1.2 3.2M16.5 17.5l-1.2 3.2"/>',
  snow: '<path d="M7 14.5h10.2a4.2 4.2 0 0 0 .6-8.4A6.2 6.2 0 0 0 5.9 7.5 3.6 3.6 0 0 0 7 14.5z"/><path d="M8.5 18v.1M12.5 19.6v.1M16.5 18v.1M10.5 21v.1M14.5 21v.1" stroke-width="2.4"/>',
  storm: '<path d="M7 14.5h10.2a4.2 4.2 0 0 0 .6-8.4A6.2 6.2 0 0 0 5.9 7.5 3.6 3.6 0 0 0 7 14.5z"/><path d="M12.8 14.8 10.2 19h3.4l-1.6 3.2"/>',
};
const svg = k => `<svg class="ico" viewBox="0 0 24 24">${ICO[k]}</svg>`;
const wmo = c => c === 0 ? ['wx0', 'sun'] : c <= 2 ? ['wx1', 'part'] : c === 3 ? ['wx2', 'cloud'] : c <= 48 ? ['wx3', 'fog'] : c <= 57 ? ['wx4', 'drizzle']
  : c <= 67 ? ['wx5', 'rain'] : c <= 77 ? ['wx6', 'snow'] : c <= 82 ? ['wx7', 'rain'] : c <= 86 ? ['wx6', 'snow'] : ['wx8', 'storm'];

function widgetBody(w) {
  switch (w.type) {
    case 'greet': return '<div class="wi tx"><div class="w-greet"></div></div>';
    case 'time': return '<div class="wi tx"><div class="w-clock"></div></div>';
    case 'date': return '<div class="wi tx"><div class="w-date"></div></div>';
    case 'weather': return '<div class="wi wx wxb"></div>';
    case 'forecast': return '<div class="wi fcb"></div>';
    case 'calendar': return '<div class="wi calb"></div>';
    case 'note': return `<div class="wi note"><div class="wh">${esc(T('wNote'))}</div><textarea data-f spellcheck="false" placeholder="${esc(T('notePh'))}">${esc(w.text || '')}</textarea></div>`;
    case 'todo': return `<div class="wi todo"><div class="wh">${esc(T('wTodo'))}</div><div class="tl">${(w.items || []).map((it, i) => `<button class="ti ${it.d ? 'done' : ''}" data-f data-ti="${i}"><i class="ck"></i><span>${esc(it.t)}</span><b class="tx" data-tx="${i}">×</b></button>`).join('')}</div><input type="text" data-f placeholder="${esc(T('todoPh'))}" maxlength="80"></div>`;
    case 'timer': return '<div class="wi tmr"></div>';
    case 'world': return `<div class="wi wrl"><div class="wl-c">${esc(w.city || '')}</div><div class="wl-t" data-tz="${esc(w.tz || '')}"></div><div class="wl-d" data-tzd="${esc(w.tz || '')}"></div></div>`;
    case 'system': return `<div class="wi sys"><div class="wh">${esc(T('wSystem'))}</div><div class="bar"><div><span>${esc(T('cpu'))}</span><b class="s-cpu">–</b></div><div class="tr"><i class="s-cpub" style="width:0"></i></div></div><div class="bar"><div><span>${esc(T('ram'))}</span><b class="s-ram">–</b></div><div class="tr"><i class="s-ramb" style="width:0"></i></div></div><div class="bar s-batw" hidden><div><span>${esc(T('battery'))}</span><b class="s-bat">–</b></div><div class="tr"><i class="s-batb" style="width:0"></i></div></div><div class="mut s-up" style="font-size:.95em"></div></div>`;
    case 'countdown': return '<div class="wi cd cdb" data-f tabindex="0"></div>';
  }
  return '';
}
function renderZone() {
  const z = $('#zone'); ro.disconnect(); z.innerHTML = '';
  for (const w of widgets()) {
    if (!WT[w.type]) continue;
    const el = document.createElement('div');
    el.className = 'wd wd-' + w.type + (WT[w.type].plain ? ' plain' : ' glass'); el.dataset.wid = w.id; el.dataset.type = w.type; place(el, w);
    el.innerHTML = widgetBody(w) + '<button class="wd-x" tabindex="-1" aria-label="×">×</button>' + ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(d => `<i class="hd hd-${d}" data-h="${d}"></i>`).join('');
    if (editing) { el.tabIndex = 0; $$('textarea,input', el).forEach(t => { t.tabIndex = -1; }); }
    if (w.id === selW) el.classList.add('sel');
    const ta = $('textarea', el); if (ta) ta.oninput = () => { w.text = ta.value; commitSoon(); };
    z.append(el); ro.observe(el);
  }
  calKey = ''; tick(); paintWx(); paintTimers(); paintCd(); sysTick();
}
function calendar() {
  const d = new Date(), key = d.toDateString() + cfg.lang; if (key === calKey) return; calKey = key;
  let first = 1; try { const l = new Intl.Locale(cfg.lang); first = (l.getWeekInfo ? l.getWeekInfo() : l.weekInfo)?.firstDay || 1; } catch {}
  const y = d.getFullYear(), m = d.getMonth(), lead = (new Date(y, m, 1).getDay() + 7 - (first % 7)) % 7, days = new Date(y, m + 1, 0).getDate();
  const names = [...Array(7)].map((_, i) => new Date(2024, 0, 7 + ((first % 7) + i) % 7).toLocaleDateString(cfg.lang, { weekday: 'narrow' }));
  const html = `<div class="cal-h">${esc(d.toLocaleDateString(cfg.lang, { month: 'long', year: 'numeric' }))}</div><div class="cal-g">${names.map(n => `<b>${esc(n)}</b>`).join('')}${'<span></span>'.repeat(lead)}${[...Array(days)].map((_, i) => `<span class="${i + 1 === d.getDate() ? 'today' : ''}">${i + 1}</span>`).join('')}</div>`;
  $$('.calb').forEach(e => { e.innerHTML = html; });
}

/* ---------- Begrüßung, Uhr, Wetter ---------- */
const pad2 = n => String(n).padStart(2, '0');
function tick() {
  const d = new Date(), h = d.getHours();
  $$('.w-greet').forEach(e => { e.textContent = T(h < 5 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'day' : h < 22 ? 'evening' : 'night'); });
  $$('.w-clock').forEach(e => { e.textContent = d.toLocaleTimeString(cfg.lang, { hour: '2-digit', minute: '2-digit', hour12: !cfg.h24 }); });
  $$('.w-date').forEach(e => { e.textContent = d.toLocaleDateString(cfg.lang, { weekday: 'long', day: 'numeric', month: 'long' }); });
  $$('.wl-t').forEach(e => { try { e.textContent = d.toLocaleTimeString(cfg.lang, { hour: '2-digit', minute: '2-digit', hour12: !cfg.h24, timeZone: e.dataset.tz || undefined }); } catch { e.textContent = '–'; } });
  $$('[data-tzd]').forEach(e => {
    try {
      const f = z => d.toLocaleDateString('en-CA', { timeZone: z || undefined }), a = new Date(f(e.dataset.tzd)), b = new Date(f());
      const diff = Math.round((a - b) / 864e5); e.textContent = diff === 0 ? T('today') : diff === 1 ? T('tomorrow') : diff === -1 ? T('yesterday') : '';
    } catch { e.textContent = ''; }
  });
  calendar(); paintTimers(); paintCd();
}
function paintWx() {
  const R = Math.round, u = cfg.fahr ? '°' : '°';
  $$('.wxb').forEach(e => {
    if (cfg.lat == null) { e.innerHTML = `<div class="wh">${esc(T('wWeather'))}</div>${svg('cloud')}<div class="wx-d">${esc(T('city'))}</div>`; return; }
    if (!wxd) { e.innerHTML = '<div class="wx-d">–</div>'; return; }
    const [k, i] = wmo(wxd.code);
    e.innerHTML = `<div class="wx-top">${svg(i)}<div class="wx-t">${R(wxd.t)}${u}</div></div><div><div class="wx-c">${esc(cfg.city)}</div><div class="wx-d">${esc(T(k))}</div><div class="wx-hl">${R(wxd.days[0].hi)}${u} / ${R(wxd.days[0].lo)}${u}</div></div><div class="wx-m"><span>${esc(T('feels'))} ${R(wxd.feels)}${u}</span><span>${esc(T('humid'))} ${R(wxd.hum)}%</span><span>${esc(T('wind'))} ${R(wxd.wind)} ${cfg.fahr ? 'mph' : 'km/h'}</span></div>`;
  });
  $$('.fcb').forEach(e => {
    if (!wxd) { e.innerHTML = `<div class="wh">${esc(T('wForecast'))}</div><div class="wx-d">${cfg.lat == null ? esc(T('city')) : '–'}</div>`; return; }
    e.innerHTML = `<div class="wh">${esc(T('wForecast'))} · ${esc(cfg.city)}</div><div class="fc-row">${wxd.days.map((d, i) => `<div class="fc"><b>${esc(i === 0 ? T('today') : new Date(d.date + 'T12:00').toLocaleDateString(cfg.lang, { weekday: 'short' }))}</b>${svg(wmo(d.code)[1])}<span class="hi">${R(d.hi)}${u}</span><span class="lo">${R(d.lo)}${u}</span><span class="rn">${d.rain != null ? R(d.rain) + '%' : ''}</span></div>`).join('')}</div>`;
  });
}
async function weather() {
  if (cfg.lat == null) { wxd = null; paintWx(); return; }
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5${cfg.fahr ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : ''}`;
    const r = await (await fetch(u)).json(), c = r.current, d = r.daily;
    wxd = { t: c.temperature_2m, feels: c.apparent_temperature, hum: c.relative_humidity_2m, wind: c.wind_speed_10m, code: c.weather_code,
      days: d.time.map((t, i) => ({ date: t, code: d.weather_code[i], hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], rain: d.precipitation_probability_max?.[i] })) };
  } catch { wxd = null; }
  paintWx();
}

/* Timer / Stoppuhr */
const timerOf = id => RT[id] || (RT[id] = { mode: 'timer', set: 300, left: 300, run: false, end: 0, t0: 0, acc: 0 });
const fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + pad2(m) : pad2(m)) + ':' + pad2(s % 60); };
function paintTimers() {
  $$('.wd-timer').forEach(el => {
    const id = el.dataset.wid, t = timerOf(id), box = $('.tmr', el);
    if (t.run && t.mode === 'timer') { t.left = (t.end - Date.now()) / 1000; if (t.left <= 0) { t.left = 0; t.run = false; timerDone(); } }
    const val = t.mode === 'timer' ? t.left : (t.run ? t.acc + (Date.now() - t.t0) / 1000 : t.acc), key = [t.mode, t.run, t.set].join();
    if (box.dataset.k !== key) {
      box.dataset.k = key;
      box.innerHTML = `<div class="tm-m"><button class="btn2 ${t.mode === 'timer' ? 'on' : ''}" data-f data-tm="timer">${esc(T('timer'))}</button><button class="btn2 ${t.mode === 'sw' ? 'on' : ''}" data-f data-tm="sw">${esc(T('stopwatch'))}</button></div><div class="tm-t"></div>
        <div class="tm-p">${t.mode === 'timer' ? [1, 5, 10, 25].map(m => `<button class="btn2" data-f data-tp="${m}">${m}′</button>`).join('') : ''}</div>
        <div class="tm-c"><button class="btn2 on" data-f data-ta="go">${esc(T(t.run ? 'pause' : 'go'))}</button><button class="btn2" data-f data-ta="rs">${esc(T('reset'))}</button></div>`;
    }
    $('.tm-t', box).textContent = fmt(val);
  });
}
function timerDone() {
  blip(880); setTimeout(() => blip(880), 260); setTimeout(() => blip(1175), 520);
  if (window.api) api.toast(T('timer'), T('timerDone'), 6000);
}
/* Countdown bis zu einem Datum */
function paintCd() {
  $$('.cdb').forEach(e => {
    const w = wById(e.closest('.wd').dataset.wid); if (!w) return;
    if (!w.date) { e.innerHTML = `<div class="wh" style="justify-content:center">${esc(T('wCountdown'))}</div><div class="cd-u">${esc(T('cdSet'))}</div>`; return; }
    const a = new Date(w.date + 'T00:00'), b = new Date(); b.setHours(0, 0, 0, 0);
    const n = Math.round((a - b) / 864e5), key = w.date + '|' + n + '|' + w.name + cfg.lang; if (e.dataset.k === key) return; e.dataset.k = key;
    e.innerHTML = `<div class="cd-n">${n === 0 ? '🎉'.replace('🎉', '0') : Math.abs(n)}</div><div class="cd-u">${esc(n === 0 ? T('today') : n > 0 ? T('daysLeft') : T('daysAgo'))}</div><div class="cd-t">${esc(w.name || '')}</div>`;
  });
}
/* System: CPU, Speicher, Akku, Laufzeit */
let sysT = 0;
async function sysTick() {
  clearTimeout(sysT);
  const els = $$('.wd-system'); if (!els.length || !window.api) return;
  try {
    const s = await api.sys(), P = v => Math.round(v * 100) + ' %';
    $$('.s-cpu').forEach(e => { e.textContent = P(s.cpu); }); $$('.s-cpub').forEach(e => { e.style.width = s.cpu * 100 + '%'; });
    $$('.s-ram').forEach(e => { e.textContent = P(s.mem); }); $$('.s-ramb').forEach(e => { e.style.width = s.mem * 100 + '%'; });
    const d = Math.floor(s.up / 86400), h = Math.floor(s.up % 86400 / 3600), m = Math.floor(s.up % 3600 / 60);
    $$('.s-up').forEach(e => { e.textContent = `${T('uptime')}: ${d ? d + ' d ' : ''}${h} h ${m} min`; });
    if (navigator.getBattery) { const b = await navigator.getBattery(); if (b && b.level != null && !(b.charging && b.level === 1 && b.chargingTime === 0 && b.dischargingTime === Infinity && false)) { $$('.s-batw').forEach(e => { e.hidden = false; }); $$('.s-bat').forEach(e => { e.textContent = Math.round(b.level * 100) + ' %' + (b.charging ? ' ⚡' : ''); }); $$('.s-batb').forEach(e => { e.style.width = b.level * 100 + '%'; }); } }
  } catch {}
  sysT = setTimeout(sysTick, 2500);
}

/* ---------- Layout bearbeiten ---------- */
function enterEdit() {
  closeModal(); editing = true; document.body.classList.add('editing'); $('#editbar').hidden = false;
  $$('.wd').forEach(e => { e.tabIndex = 0; }); $$('.wd textarea,.wd input').forEach(t => { t.tabIndex = -1; });
  ($('.wd') || $('#eDone')).focus();
}
async function exitEdit() {
  editing = false; selW = null; document.body.classList.remove('editing'); $('#editbar').hidden = true;
  $$('.wd').forEach(e => { e.removeAttribute('tabindex'); e.classList.remove('sel'); }); $$('.wd textarea,.wd input').forEach(t => { t.tabIndex = 0; });
  await commit(); $('.tile')?.focus();
}
const select = id => { selW = id; $$('.wd').forEach(e => e.classList.toggle('sel', e.dataset.wid === id)); };
async function removeWidget(id) { cfg.widgets = widgets().filter(w => w.id !== id); await commit(); renderZone(); ($('.wd') || $('#eAdd')).focus(); }
async function addWidget(w) {
  const t = WT[w.type], n = widgets().length;
  Object.assign(w, { id: w.type + '-' + Date.now().toString(36), x: 30 + (n * 7) % 40, y: 10 + (n * 6) % 30, w: t.w, h: t.h });
  cfg.widgets = [...widgets(), w]; await commit(); renderZone(); closeModal();
  const el = $(`.wd[data-wid="${w.id}"]`); if (el) { fit(el, w); commitSoon(); select(w.id); }
  if (editing) el?.focus(); else enterEdit();
}
function addWidgetModal() {
  const types = Object.keys(WT);
  const m = modal('addw', `<h2>${esc(T('addWidget'))}</h2><div class="chips" style="gap:.7rem">${types.map(t => `<button class="btn" data-f data-wt="${t}" style="flex:0 0 calc(50% - .4rem)">${esc(T(WT[t].k))}</button>`).join('')}</div><div class="actions"><button class="btn" data-f id="wx">${esc(T('cancel'))}</button></div>`);
  $$('[data-wt]', m).forEach(b => b.onclick = () => b.dataset.wt === 'world' ? worldForm() : b.dataset.wt === 'countdown' ? countdownForm() : addWidget({ type: b.dataset.wt }));
  $('#wx', m).onclick = () => { closeModal(); if (editing) $('.wd')?.focus(); };
}
function worldForm() {
  const m = modal('world', `<h2>${esc(T('wWorld'))}</h2><label>${esc(T('wCity'))}</label><input type="text" data-f id="wc" placeholder="Tokyo"><div class="hint" id="wm"></div>
    <div class="actions"><button class="btn" data-f id="wback">${esc(T('back'))}</button><button class="btn primary" data-f id="wok">${esc(T('apply'))}</button></div>`);
  $('#wc', m).focus(); $('#wback', m).onclick = addWidgetModal;
  $('#wok', m).onclick = async () => {
    const q = $('#wc', m).value.trim(), msg = $('#wm', m); if (!q) return; msg.textContent = '…';
    try {
      const r = (await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=${cfg.lang}`)).json()).results?.[0];
      if (!r || !r.timezone) { msg.textContent = T('cityNf'); return; }
      addWidget({ type: 'world', city: r.name, tz: r.timezone });
    } catch { msg.textContent = '–'; }
  };
}
function countdownForm(w) {
  const m = modal('cd', `<h2>${esc(T('wCountdown'))}</h2><label>${esc(T('name'))}</label><input type="text" data-f id="cn" maxlength="30" value="${esc(w?.name || '')}"><label>${esc(T('cdDate'))}</label><input type="date" data-f id="cdt" value="${esc(w?.date || '')}">
    <div class="actions"><button class="btn" data-f id="cback">${esc(w ? T('cancel') : T('back'))}</button><button class="btn primary" data-f id="cok">${esc(T('apply'))}</button></div>`);
  $('#cn', m).focus(); $('#cback', m).onclick = w ? closeModal : addWidgetModal;
  $('#cok', m).onclick = async () => {
    const name = $('#cn', m).value.trim(), date = $('#cdt', m).value; if (!date) { $('#cdt', m).focus(); return; }
    if (w) { w.name = name; w.date = date; await commit(); renderZone(); closeModal(); } else addWidget({ type: 'countdown', name, date });
  };
}
let drag = null;
$('#zone').addEventListener('pointerdown', e => {
  if (!editing) return;
  const el = e.target.closest('.wd'); if (!el) return;
  if (!cfg.widgets) cfg.widgets = defaultWidgets();
  const w = wById(el.dataset.wid); if (!w) return;
  if (e.target.closest('.wd-x')) { e.preventDefault(); removeWidget(w.id); return; }
  select(w.id);
  drag = { el, w, h: e.target.closest('.hd')?.dataset.h || '', sx: e.clientX, sy: e.clientY, x0: w.x, y0: w.y, w0: w.w, h0: w.h, zr: $('#zone').getBoundingClientRect() };
  el.setPointerCapture(e.pointerId); el.focus(); e.preventDefault();
});
$('#zone').addEventListener('pointermove', e => {
  if (!drag) return; const d = drag, dx = (e.clientX - d.sx) / d.zr.width * 100, dy = (e.clientY - d.sy) / d.zr.height * 100, sn = v => Math.round(v * 2) / 2, w = d.w, MIN = 4;
  if (d.h) {
    let x = d.x0, y = d.y0, ww = d.w0, hh = d.h0;
    if (d.h.includes('e')) ww = d.w0 + dx;
    if (d.h.includes('s')) hh = d.h0 + dy;
    if (d.h.includes('w')) { ww = d.w0 - dx; x = d.x0 + dx; }
    if (d.h.includes('n')) { hh = d.h0 - dy; y = d.y0 + dy; }
    if (ww < MIN) { if (d.h.includes('w')) x = d.x0 + d.w0 - MIN; ww = MIN; }
    if (hh < MIN) { if (d.h.includes('n')) y = d.y0 + d.h0 - MIN; hh = MIN; }
    if (x < 0) { ww += x; x = 0; } if (y < 0) { hh += y; y = 0; }
    if (x + ww > 100) ww = 100 - x; if (y + hh > 100) hh = 100 - y;
    w.x = sn(x); w.y = sn(y); w.w = sn(ww); w.h = sn(hh);
  } else { w.x = sn(d.x0 + dx); w.y = sn(d.y0 + dy); }
  fit(d.el, w);
});
const endDrag = () => { if (drag) { drag = null; commit(); } };
$('#zone').addEventListener('pointerup', endDrag); $('#zone').addEventListener('pointercancel', endDrag);
$('#eAdd').onclick = addWidgetModal; $('#eDone').onclick = exitEdit;
$('#eReset').onclick = async () => { cfg.widgets = null; selW = null; await save({ widgets: null }); renderZone(); $('.wd')?.focus(); };
$$('[data-sz]').forEach(b => b.onclick = async () => {
  const w = selW && wById(selW); if (!w) return; const t = WT[w.type], k = +b.dataset.sz;
  w.w = +(t.w * k).toFixed(1); w.h = +(t.h * k).toFixed(1);
  const el = $(`.wd[data-wid="${w.id}"]`); fit(el, w); await commit(); el.focus();
});
/* Tastatur im Bearbeitungsmodus: Pfeile verschieben, Umschalt + Pfeile ändern die Größe, Entf entfernt */
function editKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); exitEdit(); return true; }
  const el = e.target.closest?.('.wd'); if (!el) return false;
  if (!cfg.widgets) cfg.widgets = defaultWidgets();
  const w = wById(el.dataset.wid); if (!w) return false;
  if (e.key.startsWith('Arrow')) {
    e.preventDefault(); select(w.id);
    const v = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (e.shiftKey) { w.w += v[0] * 1.5; w.h += v[1] * 2; } else { w.x += v[0]; w.y += v[1]; }
    fit(el, w); commitSoon(); return true;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeWidget(w.id); return true; }
  if (e.key === 'Enter') { e.preventDefault(); exitEdit(); return true; }
  return false;
}
/* Bedienung der Widgets im normalen Modus (Timer, Aufgaben, Countdown) */
$('#zone').addEventListener('click', async e => {
  if (editing) return;
  const el = e.target.closest('.wd'); if (!el) return;
  const id = el.dataset.wid, w = wById(id);
  const tm = e.target.closest('[data-tm],[data-tp],[data-ta]');
  if (tm) {
    const t = timerOf(id);
    if (tm.dataset.tm) { t.mode = tm.dataset.tm; t.run = false; t.acc = 0; t.left = t.set; }
    else if (tm.dataset.tp) { t.set = +tm.dataset.tp * 60; t.left = t.set; t.run = false; }
    else if (tm.dataset.ta === 'go') {
      if (t.run) { if (t.mode === 'sw') t.acc += (Date.now() - t.t0) / 1000; else t.left = (t.end - Date.now()) / 1000; t.run = false; }
      else { t.run = true; if (t.mode === 'timer') { if (t.left <= 0) t.left = t.set; t.end = Date.now() + t.left * 1000; } else t.t0 = Date.now(); }
    } else { t.run = false; t.acc = 0; t.left = t.set; }
    const box = $('.tmr', el); box.dataset.k = ''; paintTimers(); $(`[data-ta="go"]`, el)?.focus(); return;
  }
  if (w && w.type === 'todo') {
    const x = e.target.closest('[data-tx]'), it = e.target.closest('[data-ti]');
    if (x) { w.items.splice(+x.dataset.tx, 1); await commit(); const sc = $('.tl', el).scrollTop; renderZone(); return; }
    if (it) { const i = +it.dataset.ti; w.items[i].d = !w.items[i].d; await commit(); renderZone(); $(`.wd[data-wid="${id}"] [data-ti="${i}"]`)?.focus(); }
  }
  if (w && w.type === 'countdown') countdownForm(w);
  if (w && w.type === 'weather') settings('general');
});
$('#zone').addEventListener('keydown', async e => {
  if (editing || e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  const el = e.target.closest('.wd'), w = el && wById(el.dataset.wid); if (!w || w.type !== 'todo') return;
  const v = e.target.value.trim(); if (!v) return;
  e.stopPropagation(); e.preventDefault();
  if (!cfg.widgets) cfg.widgets = defaultWidgets(); const w2 = wById(w.id); w2.items = [...(w2.items || []), { t: v, d: false }];
  await commit(); renderZone(); $(`.wd[data-wid="${w.id}"] input`)?.focus();
}, true);

/* ---------- Schnellstart (ganz oben): kleine Icons, normale Programme ohne Vollbild ---------- */
function renderQuick() {
  const q = $('#qbar'); q.innerHTML = '';
  for (const a of cfg.quick) {
    const b = document.createElement('button');
    b.className = 'qi'; b.dataset.f = 1; b.dataset.q = a.id; b.setAttribute('aria-label', a.name);
    b.innerHTML = (a.icon ? `<img src="${a.icon}" alt="">` : `<span class="mono">${esc((a.name[0] || '?').toUpperCase())}</span>`) + `<span class="qn">${esc(a.name)}</span>`;
    b.onclick = () => { blip(700); api.quickLaunch(a.id); };
    b.oncontextmenu = e => { e.preventDefault(); quickOptions(a); };
    q.append(b);
  }
  if (!cfg.quick.length) { const l = document.createElement('span'); l.className = 'qlabel'; l.textContent = T('quick'); q.append(l); }
  const add = document.createElement('button'); add.className = 'qi add'; add.dataset.f = 1; add.setAttribute('aria-label', T('quickAdd')); add.textContent = '+';
  add.innerHTML = `+<span class="qn">${esc(T('quickAdd'))}</span>`; add.onclick = () => form(null, 'quick'); q.append(add);
}
function quickOptions(a) {
  const i = cfg.quick.findIndex(x => x.id === a.id);
  const m = modal('qopt', `<h2>${esc(a.name)}</h2><div class="stack">
    <button class="btn primary" data-f id="o-open">${esc(T('open'))}</button>
    ${i > 0 ? `<button class="btn" data-f id="o-l">← ${esc(T('moveL'))}</button>` : ''}${i < cfg.quick.length - 1 ? `<button class="btn" data-f id="o-r">${esc(T('moveR'))} →</button>` : ''}
    <button class="btn danger" data-f id="o-del">${esc(T('remove'))}</button><button class="btn" data-f id="o-x">${esc(T('close'))}</button></div>`);
  $('#o-open', m).onclick = () => { closeModal(); api.quickLaunch(a.id); };
  if ($('#o-l', m)) $('#o-l', m).onclick = async () => { await api.moveApp(a.id, -1, true); closeModal(); };
  if ($('#o-r', m)) $('#o-r', m).onclick = async () => { await api.moveApp(a.id, 1, true); closeModal(); };
  let sure = false; $('#o-del', m).onclick = e => { if (!sure) { sure = true; e.target.textContent = T('sure'); } else { closeModal(); api.removeApp(a.id, true); } };
  $('#o-x', m).onclick = closeModal;
}

/* ---------- Kacheln ---------- */
function render() {
  const row = $('#row'); row.innerHTML = '';
  $('#empty').hidden = cfg.apps.length > 0;
  for (const a of cfg.apps) {
    const t = document.createElement('button');
    t.className = 'tile'; t.dataset.f = 1; t.dataset.id = a.id; t.style.setProperty('--c', colorOf(a));
    t.innerHTML = `<div class="card">${a.icon ? `<img src="${a.icon}" alt="">` : `<span class="mono">${esc((a.name[0] || '?').toUpperCase())}</span>`}</div><div class="name">${esc(a.name)}</div>${(cfg.running || []).includes(a.id) ? '<i class="run"></i>' : ''}`;
    t.onclick = () => { blip(700); api.launch(a.id); };
    t.oncontextmenu = e => { e.preventDefault(); options(a); };
    row.append(t);
  }
  const add = document.createElement('button');
  add.className = 'tile add'; add.dataset.f = 1;
  add.innerHTML = `<div class="card">+</div><div class="name">${esc(T('add'))}</div>`;
  add.onclick = () => form(); row.append(add);
  requestAnimationFrame(() => centerTile(document.activeElement?.closest?.('.tile') || row.firstElementChild, true));
}
/* Die Reihe wird per GPU-Transform verschoben (statt scrollIntoView): kein Ruckeln, immer dieselbe weiche Kurve */
function centerTile(t, instant) {
  const wrap = $('#rowwrap'), row = $('#row'), first = row.firstElementChild; if (!t || !wrap || !first) return;
  const ty = -(t.offsetTop - first.offsetTop);   // die Reihe des Fokus rutscht an dieselbe Stelle wie die erste Reihe
  if (instant) { row.style.transition = 'none'; row.style.transform = `translate3d(0,${ty}px,0)`; void row.offsetWidth; row.style.transition = ''; }
  else { navLock = performance.now() + 800; row.style.transform = `translate3d(0,${ty}px,0)`; }
}
let navLock = 0;
addEventListener('resize', () => centerTile(document.activeElement?.closest?.('.tile') || $('.tile'), true));
function pill() { $('#pill').hidden = cfg.paired > 0; }
function blip(f = 520) {
  if (!cfg.sounds && f < 800) return;
  try {
    AC = AC || new AudioContext(); const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine'; o.frequency.value = f; g.gain.value = .035; o.connect(g); g.connect(AC.destination);
    g.gain.setTargetAtTime(0, AC.currentTime + .03, .02); o.start(); o.stop(AC.currentTime + .1);
  } catch {}
}

/* ---------- Ladeanimation: Kachel wächst zum Vollbild, während die App im Hintergrund startet ---------- */
function launching(a) {
  const L = $('#launch'), tile = $(`.tile[data-id="${a.id}"] .card`);
  const from = tile ? tile.getBoundingClientRect() : { left: innerWidth / 2 - 115, top: innerHeight / 2 - 72, width: 230, height: 144 };
  L.style.setProperty('--c', colorOf(a)); L.className = 'on';
  L.innerHTML = `<div class="lbg"></div><div class="lwrap"><div class="lcard">${a.icon ? `<img src="${a.icon}" alt="">` : `<span class="mono">${esc((a.name[0] || '?').toUpperCase())}</span>`}</div></div><i class="lring"></i><div class="lname">${esc(a.name)}</div>`;
  const card = $('.lcard', L), to = card.getBoundingClientRect();
  if (!reduce) card.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` }, { transform: 'none' }], { duration: 620, easing: 'cubic-bezier(.2,.85,.2,1)', fill: 'both' });
}
const launchReset = () => { const L = $('#launch'); L.className = ''; L.innerHTML = ''; };

/* ---------- Dialoge ---------- */
function modal(id, html, cls = '') {
  if (modalEl && modalId === id) { const s = $('.sheet', modalEl); s.innerHTML = html; s.className = 'sheet glass ' + cls; $('[data-f]:not([hidden])', modalEl)?.focus(); return modalEl; }
  closeModal(); prevFocus = document.activeElement; modalId = id;
  const m = modalEl = document.createElement('div');
  m.className = 'modal' + (id === 'welcome' ? ' dim' : ''); m.innerHTML = `<div class="sheet glass ${cls}">${html}</div>`;
  document.body.append(m);
  m.addEventListener('mousedown', e => { if (e.target === m && id !== 'welcome') closeModal(); });
  requestAnimationFrame(() => { m.classList.add('open'); $('[data-f]:not([hidden])', m)?.focus(); });
  return m;
}
function closeModal() {
  if (!modalEl) return;
  const m = modalEl; modalEl = null; modalId = null; m.classList.remove('open'); setTimeout(() => m.remove(), 250);
  if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
}
const save = async d => { Object.assign(cfg, d); await api.setConfig(d); };
const themeSeg = () => ['system', 'dark', 'light'].map(v => `<button class="btn ${cfg.theme === v ? 'on' : ''}" data-f data-theme="${v}">${esc(T({ system: 'tSys', dark: 'tDark', light: 'tLight' }[v]))}</button>`).join('');
const swatches = () => ACCENTS.map(c => `<button class="sw ${cfg.accent === c ? 'on' : ''}" data-f data-acc="${c}" style="--s:${c}" aria-label="${c}"></button>`).join('');
const langChips = () => I18N.langs.map(l => `<button class="btn ${cfg.lang === l.code ? 'on' : ''}" data-f data-lang="${l.code}" lang="${l.code}">${l.name}</button>`).join('');
function bindLook(m, rerender) {
  $$('[data-theme]', m).forEach(b => b.onclick = async () => { await save({ theme: b.dataset.theme }); applyTheme(); rerender(); });
  $$('[data-acc]', m).forEach(b => b.onclick = async () => { await save({ accent: b.dataset.acc }); applyTheme(); rerender(); });
  $$('[data-lang]', m).forEach(b => b.onclick = async () => { await save({ lang: b.dataset.lang }); applyLang(); rerender(); });
}
const refocus = sel => requestAnimationFrame(() => $(sel, modalEl)?.focus());

/* ---------- Willkommen ---------- */
function welcome(step = 0) {
  const dots = `<div class="dots">${[0, 1, 2, 3, 4].map(i => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>`;
  const nav = (back, label = T('next')) => `<div class="actions">${back ? `<button class="btn" data-f id="wb">${esc(T('back'))}</button>` : ''}<button class="btn primary" data-f id="wn">${esc(label)}</button></div>`;
  let h;
  if (step === 0) h = `${dots}<h1>${esc(T('welcome'))}</h1><p class="sub">${esc(T('wSub'))}</p><div class="chips">${langChips()}</div>${nav(false)}`;
  if (step === 1) h = `${dots}<h2>${esc(T('device'))}</h2><input type="text" data-f id="dn" value="${esc(cfg.deviceName || '')}" maxlength="40"><div class="hint">${esc(T('devHint'))}</div>${nav(true)}`;
  if (step === 2) h = `${dots}<h2>${esc(T('appearance'))}</h2><label>${esc(T('theme'))}</label><div class="seg">${themeSeg()}</div><label>${esc(T('accent'))}</label><div class="swatches">${swatches()}</div>${nav(true)}`;
  if (step === 3) h = `${dots}<h2>${esc(T('accCreate'))}</h2><div id="acct"></div><div class="actions"><button class="btn" data-f id="wb">${esc(T('back'))}</button><button class="btn ${acc().signedIn ? 'primary' : ''}" data-f id="wn">${esc(T(acc().signedIn ? 'next' : 'accSkip'))}</button></div>`;
  if (step === 4) h = `${dots}<div class="check"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h1>${esc(T('done'))}</h1><p class="sub">${esc(acc().username || cfg.deviceName)}</p>${nav(true, T('start'))}`;
  const m = modal('welcome', h, 'wide');
  bindLook(m, () => welcome(step));
  if (step === 0) refocus('#wn');
  $('#wb', m) && ($('#wb', m).onclick = () => welcome(step - 1));
  if (step === 3) mountAccount($('#acct', m), { onSuccess: () => welcome(4) });
  $('#wn', m).onclick = async () => {
    if (step === 1) await save({ deviceName: $('#dn', m).value.trim() || cfg.deviceName });
    if (step === 4) { await save({ onboarded: true }); applyLang(); closeModal(); $('.tile')?.focus(); return; }
    welcome(step + 1);
  };
}

/* ---------- Kachel-Menü und Formular ---------- */
function options(a) {
  const i = cfg.apps.findIndex(x => x.id === a.id), run = (cfg.running || []).includes(a.id);
  const m = modal('options', `<h2>${esc(a.name)}</h2><div class="stack">
    <button class="btn primary" data-f id="o-open">${esc(T('open'))}</button>
    ${run ? `<button class="btn" data-f id="o-stop">${esc(T('closeRun'))}</button>` : ''}
    <button class="btn" data-f id="o-edit">${esc(T('edit'))}</button>
    ${i > 0 ? `<button class="btn" data-f id="o-l">← ${esc(T('moveL'))}</button>` : ''}
    ${i < cfg.apps.length - 1 ? `<button class="btn" data-f id="o-r">${esc(T('moveR'))} →</button>` : ''}
    <button class="btn danger" data-f id="o-del">${esc(T('remove'))}</button>
    <button class="btn" data-f id="o-x">${esc(T('close'))}</button></div>`);
  $('#o-open', m).onclick = () => { closeModal(); api.launch(a.id); };
  if ($('#o-stop', m)) $('#o-stop', m).onclick = () => { closeModal(); api.closeApp(a.id); };
  $('#o-edit', m).onclick = () => form(a);
  if ($('#o-l', m)) $('#o-l', m).onclick = async () => { await api.moveApp(a.id, -1); closeModal(); };
  if ($('#o-r', m)) $('#o-r', m).onclick = async () => { await api.moveApp(a.id, 1); closeModal(); };
  let sure = false;
  $('#o-del', m).onclick = e => { if (!sure) { sure = true; e.target.textContent = T('sure'); } else { closeModal(); api.removeApp(a.id); } };
  $('#o-x', m).onclick = closeModal;
}
const ddItem = (p, i, sec) => `<button class="dd-i" data-f data-p="${sec}:${i}"><i>${p.icon ? `<img src="${p.icon}" alt="">` : esc((p.name[0] || '?').toUpperCase())}</i><div><b>${esc(p.name)}</b><small>${esc(p.sub || p.target)}</small></div></button>`;
function form(edit, dest) {
  const S = { type: edit ? edit.type : (dest === 'quick' ? 'exe' : 'web'), dest: dest === 'quick' ? 'quick' : 'tile', icon: edit ? 'keep' : 'auto', iconPath: null, engine: edit?.engine || 'auto',
    exe: edit && edit.type === 'exe' ? edit.target : '', args: edit?.args || [], touched: !!edit, list: null, open: false };
  const m = modal('form', `<h2>${esc(T(edit ? 'editT' : dest === 'quick' ? 'quickAdd' : 'addT'))}</h2>
    <div class="seg" ${edit || dest === 'quick' ? 'hidden' : ''}><button class="btn" data-f data-type="web">${esc(T('web'))}</button><button class="btn" data-f data-type="exe">${esc(T('prog'))}</button></div>
    <div id="fw"><label>${esc(T('addr'))}</label><input type="text" data-f id="url" placeholder="netflix.com" value="${edit && edit.type === 'web' ? esc(edit.target) : ''}"></div>
    <div id="fe"><label>${esc(T('prog'))}</label><div class="pk"><button class="btn" data-f id="pick">${esc(T('pickProg'))} ▾</button><span class="hint" id="exeName" style="margin:0"></span></div><div class="dd" id="dd" hidden></div></div>
    <div id="fd" ${edit ? 'hidden' : ''}><label>${esc(T('dest'))}</label><div class="seg"><button class="btn" data-f data-dest="tile">${esc(T('destTile'))}</button><button class="btn" data-f data-dest="quick">${esc(T('destQuick'))}</button></div></div>
    <div id="fb"><label>${esc(T('browser'))}</label><div class="seg"><button class="btn" data-f data-eng="auto">${esc(T('auto'))}</button><button class="btn" data-f data-eng="builtin">${esc(T('bBuilt'))}</button><button class="btn" data-f data-eng="edge">${esc(T('bEdge'))}</button></div></div>
    <label>${esc(T('name'))}</label><input type="text" data-f id="name" value="${edit ? esc(edit.name) : ''}">
    <label>${esc(T('image'))}</label>
    <div class="seg"><button class="btn" data-f data-icon="${edit ? 'keep' : 'auto'}">${esc(T(edit ? 'keep' : 'auto'))}</button><button class="btn" data-f data-icon="file">${esc(T('own'))}</button></div>
    <div class="actions"><button class="btn" data-f id="cancel">${esc(T('cancel'))}</button><button class="btn primary" data-f id="ok">${esc(T('save'))}</button></div>`, 'wide');
  const nm = $('#name', m);
  const sync = () => {
    $$('[data-type]', m).forEach(b => b.classList.toggle('on', b.dataset.type === S.type));
    $$('[data-dest]', m).forEach(b => b.classList.toggle('on', b.dataset.dest === S.dest));
    $('#fw', m).hidden = S.type !== 'web'; $('#fb', m).hidden = S.type !== 'web' || S.dest === 'quick'; $('#fe', m).hidden = S.type !== 'exe'; $('#fd', m).hidden = !!edit || S.type !== 'exe';
    $$('[data-eng]', m).forEach(b => b.classList.toggle('on', b.dataset.eng === S.engine));
    $$('[data-icon]', m).forEach(b => b.classList.toggle('on', b.dataset.icon === S.icon));
    $('#exeName', m).textContent = S.exe ? S.exe.split(/[\\/]/).pop() : '';
  };
  const guess = t => { if (!S.touched) nm.value = t; };
  nm.oninput = () => { S.touched = true; };
  $$('[data-type]', m).forEach(b => b.onclick = () => { S.type = b.dataset.type; if (S.type === 'web') S.dest = 'tile'; sync(); });
  $$('[data-dest]', m).forEach(b => b.onclick = () => { S.dest = b.dataset.dest; sync(); });
  $$('[data-eng]', m).forEach(b => b.onclick = () => { S.engine = b.dataset.eng; sync(); });
  $('#url', m).oninput = e => {
    try { const v = e.target.value; guess(new URL(/^https?:/i.test(v) ? v : 'https://' + v).hostname.replace(/^www\./, '').split('.')[0].replace(/^./, c => c.toUpperCase())); } catch {}
  };
  /* Dropdown: erst die gerade geöffneten Programme, darunter zufällige Vorschläge aus den installierten */
  const dd = $('#dd', m);
  const choose = p => { S.exe = p.target; S.args = p.args || []; if (p.iconFile && S.icon === 'auto') { /* Linux: Symbol aus dem Systemthema */ } guess(p.name); S.open = false; dd.hidden = true; sync(); refocus('#name'); };
  const fill = () => {
    const L = S.list; if (!L) { dd.innerHTML = `<h5>${esc(T('looking'))}</h5>`; return; }
    dd.innerHTML = `<h5>${esc(T('ddRunning'))}</h5>${L.running.length ? L.running.map((p, i) => ddItem(p, i, 'r')).join('') : `<div class="hint" style="padding:.2rem .8rem">${esc(T('ddNone'))}</div>`}
      <h5>${esc(T('ddSuggest'))}<button class="btn" data-f id="shuf" style="padding:.25rem .8rem;font-size:.9rem">↻ ${esc(T('ddMore'))}</button></h5>${L.suggest.map((p, i) => ddItem(p, i, 's')).join('')}
      <h5></h5><button class="dd-i" data-f id="browse"><i>…</i><div><b>${esc(T('ddFile'))}</b></div></button>`;
    $$('[data-p]', dd).forEach(b => b.onclick = () => { const [s, i] = b.dataset.p.split(':'); choose((s === 'r' ? L.running : L.suggest)[+i]); });
    $('#browse', dd).onclick = async () => { const p = await api.pickExe(); if (p) { S.exe = p; S.args = []; guess(p.split(/[\\/]/).pop().replace(/\.(exe|app)$/i, '')); S.open = false; dd.hidden = true; sync(); refocus('#name'); } };
    $('#shuf', dd).onclick = async () => { S.list = null; fill(); S.list = await api.programs(); fill(); refocus('#shuf'); };
  };
  $('#pick', m).onclick = async () => {
    S.open = !S.open; dd.hidden = !S.open; if (!S.open) return;
    fill(); if (!S.list) { S.list = await api.programs(); fill(); }
    $('[data-p]', dd)?.focus();
  };
  $$('[data-icon]', m).forEach(b => b.onclick = async () => {
    if (b.dataset.icon === 'file') { const p = await api.pickImage(); if (p) { S.icon = 'file'; S.iconPath = p; } } else S.icon = b.dataset.icon;
    sync();
  });
  $('#cancel', m).onclick = closeModal;
  $('#ok', m).onclick = async () => {
    const target = S.type === 'web' ? $('#url', m).value.trim() : S.exe;
    if (!target) { (S.type === 'web' ? $('#url', m) : $('#pick', m)).focus(); return; }
    const ok = $('#ok', m); ok.disabled = true; ok.textContent = T('loading');
    await api.saveApp({ id: edit?.id, type: S.type, quick: !edit && S.type === 'exe' && S.dest === 'quick', name: nm.value, target, args: S.args, engine: S.engine, iconMode: S.icon, iconPath: S.iconPath });
    closeModal();
  };
  sync();
}

/* ---------- Einstellungen: Kopfzeile mit den Reitern bleibt immer fest oben ---------- */
const FS = [.85, 1, 1.15, 1.3, 1.5, 1.75];
const tog = (b, label, get, set) => {
  const u = () => { b.textContent = `${label}: ${get() ? '✓' : '–'}`; b.classList.toggle('on', get()); };
  b.onclick = async () => { await set(!get()); u(); }; u();
};
const TABS = ['appearance', 'general', 'layout', 'quick', 'remote', 'power'];
let setScroll = 0;
function settings(tab = 'appearance') {
  let body = '';
  if (tab === 'appearance') body = `<label>${esc(T('theme'))}</label><div class="seg">${themeSeg()}</div>
    <label>${esc(T('accent'))}</label><div class="swatches">${swatches()}</div>
    <label>${esc(T('lang'))}</label><div class="chips">${langChips()}</div>
    <label>${esc(T('wall'))}</label><div class="seg"><button class="btn" data-f id="wp">${esc(T('wallAdd'))}</button>${cfg.walls?.length ? `<button class="btn" data-f id="wc">${esc(T('wallDel'))}</button>` : ''}<button class="btn" data-f id="sl"></button><button class="btn" data-f id="dw"></button><button class="btn" data-f id="calm"></button></div>
    <label>${esc(T('slideSec'))}</label><div class="seg">${[10, 20, 40, 60].map(v => `<button class="btn ${(cfg.slideSec || 20) === v ? 'on' : ''}" data-f data-ss="${v}">${v} s</button>`).join('')}</div>
    <label>${esc(T('fontSize'))}</label><div class="seg">${FS.map(v => `<button class="btn ${Math.abs((cfg.fontScale || 1) - v) < .01 ? 'on' : ''}" data-f data-fs="${v}">${Math.round(v * 100)}%</button>`).join('')}</div>`;
  if (tab === 'layout') body = `<div class="hint" style="margin-top:.3rem">${esc(T('layoutHint'))}</div><div class="seg" style="margin-top:1.2rem"><button class="btn primary" data-f id="le">${esc(T('editLayout'))}</button><button class="btn" data-f id="la">${esc(T('addWidget'))}</button><button class="btn" data-f id="lr">${esc(T('resetLayout'))}</button></div>`;
  if (tab === 'general') body = `<label>${esc(T('device'))}</label><input type="text" data-f id="dn" value="${esc(cfg.deviceName || '')}" maxlength="40">
    <label>${esc(T('city'))}</label><div class="line"><input type="text" data-f id="city" value="${esc(cfg.city || '')}"><button class="btn" data-f id="saveCity">${esc(T('apply'))}</button></div><div class="hint" id="cityMsg"></div>
    <label>${esc(T('general'))}</label><div class="seg"><button class="btn" data-f id="auto"></button><button class="btn" data-f id="escc"></button><button class="btn" data-f id="ctl"></button><button class="btn" data-f id="snd"></button><button class="btn" data-f id="h24"></button><button class="btn" data-f id="fh"></button><button class="btn" data-f id="shr"></button></div>
    <label>${esc(T('updates'))}: v${esc(cfg.version || '')}</label><div class="line"><button class="btn" data-f id="updchk">${esc(T('updCheck'))}</button>${UPDS.state === 'ready' || UPDS.state === 'manual' ? `<button class="btn primary" data-f id="updgo">${esc(UPDS.state === 'ready' ? T('updRestart') : T('updGet'))}</button>` : ''}</div><div class="hint" id="updline">${esc(updText(UPDS))}</div>`;
  if (tab === 'quick') body = `<div class="hint" style="margin:.3rem 0 1rem">${esc(T('quickHint'))}</div>${cfg.quick.map(a => `<div class="qrow"><i>${a.icon ? `<img src="${a.icon}" alt="">` : esc((a.name[0] || '?').toUpperCase())}</i><span>${esc(a.name)}</span><button class="btn" data-f data-qm="${a.id}:-1">←</button><button class="btn" data-f data-qm="${a.id}:1">→</button><button class="btn danger" data-f data-qd="${a.id}">${esc(T('remove'))}</button></div>`).join('')}<div class="actions" style="justify-content:flex-start;margin-top:1rem"><button class="btn primary" data-f id="qa">+ ${esc(T('quickAdd'))}</button></div>`;
  if (tab === 'remote') body = `<div class="remote"><img id="qr" alt="QR"><div><div class="hint" style="margin:0">${esc(T('remoteHint'))}</div><div id="pin"></div><div class="hint" id="rurl"></div><div class="hint" id="paired"></div></div></div>
    <div class="actions" style="justify-content:flex-start;margin-top:1rem"><button class="btn" data-f id="unpair">${esc(T('unpair'))}</button></div>
    <label style="margin-top:1.6rem">${esc(T('curBig'))}</label><div class="seg"><button class="btn" data-f id="cb"></button></div>
    <label>${esc(T('curSize'))}: <b id="csv"></b></label><div class="slider"><input type="range" data-f id="cs" min="1" max="5" step="0.25" value="${cfg.cursorSize || 2}"><div id="cprev"></div></div><div class="hint">${esc(T('curNote'))}</div>`;
  if (tab === 'power') body = `<div class="seg" style="margin-top:.4rem"><button class="btn" data-f data-pw="sleep">${esc(T('sleep'))}</button><button class="btn" data-f data-pw="restart">${esc(T('restart'))}</button><button class="btn danger" data-f data-pw="shutdown">${esc(T('shutdown'))}</button></div>
    <div class="actions" style="justify-content:flex-start"><button class="btn danger" data-f id="quit">${esc(T('quit'))}</button></div>`;
  const keep = modalId === 'settings' ? $('.sh-body', modalEl)?.scrollTop || 0 : 0;
  const m = modal('settings', `<div class="sh-head"><h2>${esc(T('settings'))}</h2><div class="seg tabs">${TABS.map(t => `<button class="btn ${t === tab ? 'on' : ''}" data-f data-tab="${t}">${esc(T(t === 'quick' ? 'quick' : t))}</button>`).join('')}</div></div><div class="sh-body">${body}</div>
    <div class="sh-foot"><button class="btn primary" data-f id="done">${esc(T('done'))}</button></div>`, 'wide settings');
  if (keep) $('.sh-body', m).scrollTop = keep;
  $$('[data-tab]', m).forEach(b => b.onclick = () => { if (b.dataset.tab !== tab) { settings(b.dataset.tab); refocus(`[data-tab="${b.dataset.tab}"]`); } });
  $('#done', m).onclick = closeModal;
  if (tab === 'appearance') {
    bindLook(m, () => { settings('appearance'); });
    $('#wp', m).onclick = async () => { cfg.walls = await api.wallPick(); wallStart(); settings('appearance'); };
    if ($('#wc', m)) $('#wc', m).onclick = async () => { cfg.walls = await api.wallClear(); wallStart(); settings('appearance'); };
    tog($('#sl', m), T('slide'), () => cfg.slide, async v => { await save({ slide: v }); wallStart(); });
    tog($('#dw', m), T('defWalls'), () => cfg.wallDefaults !== false, async v => { await save({ wallDefaults: v }); wallStart(); });
    tog($('#calm', m), T('calm'), () => cfg.calm, async v => { await save({ calm: v }); applyTheme(); wallStart(); });
    $$('[data-ss]', m).forEach(b => b.onclick = async () => { await save({ slideSec: +b.dataset.ss }); wallStart(); settings('appearance'); refocus(`[data-ss="${b.dataset.ss}"]`); });
    $$('[data-fs]', m).forEach(b => b.onclick = async () => { await save({ fontScale: +b.dataset.fs }); applyTheme(); settings('appearance'); refocus(`[data-fs="${b.dataset.fs}"]`); });
  }
  if (tab === 'layout') {
    $('#le', m).onclick = enterEdit; $('#la', m).onclick = addWidgetModal;
    $('#lr', m).onclick = async () => { await save({ widgets: null }); renderZone(); closeModal(); };
  }
  if (tab === 'quick') {
    $('#qa', m).onclick = () => form(null, 'quick');
    $$('[data-qm]', m).forEach(b => b.onclick = async () => { const [id, d] = b.dataset.qm.split(':'); await api.moveApp(id, +d, true); setTimeout(() => settings('quick'), 80); });
    $$('[data-qd]', m).forEach(b => b.onclick = async () => { await api.removeApp(b.dataset.qd, true); setTimeout(() => settings('quick'), 80); });
  }
  if (tab === 'general') {
    $('#dn', m).onchange = async e => { await save({ deviceName: e.target.value.trim() || cfg.deviceName }); applyLang(); };
    $('#saveCity', m).onclick = async () => {
      const q = $('#city', m).value.trim(), msg = $('#cityMsg', m); if (!q) return; msg.textContent = '…';
      try {
        const r = (await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=${cfg.lang}`)).json()).results?.[0];
        if (!r) { msg.textContent = T('cityNf'); return; }
        await save({ city: r.name, lat: r.latitude, lon: r.longitude }); msg.textContent = `${T('saved')}: ${r.name}${r.country ? ', ' + r.country : ''}`; weather();
      } catch { msg.textContent = '–'; }
    };
    tog($('#auto', m), T('autostart'), () => cfg.autostart, async v => { cfg.autostart = v; await api.setConfig({ autostart: v }); });
    tog($('#escc', m), T('dblEsc'), () => cfg.escClose, v => save({ escClose: v }));
    tog($('#ctl', m), T('ctrlL'), () => cfg.ctrlL !== false, v => save({ ctrlL: v }));
    tog($('#snd', m), T('sounds'), () => cfg.sounds, async v => { await save({ sounds: v }); blip(); });
    tog($('#h24', m), T('h24'), () => cfg.h24, async v => { await save({ h24: v }); tick(); });
    tog($('#fh', m), T('fahr'), () => cfg.fahr, async v => { await save({ fahr: v }); weather(); });
    $('#updchk', m).onclick = async () => { $('#updline').textContent = T('updChecking'); UPDS = await api.update.check() || UPDS; paintUpd(); };
    if ($('#updgo', m)) $('#updgo', m).onclick = () => api.update.install();
    tog($('#shr', m), T('accShare'), () => cfg.shareActivity !== false, v => save({ shareActivity: v }));
  }
  if (tab === 'remote') {
    $('#unpair', m).onclick = () => api.unpair(); refreshRemote();
    tog($('#cb', m), T('curBigShort'), () => !!cfg.cursorBig, v => save({ cursorBig: v }));
    const cs = $('#cs', m), prev = () => { $('#csv', m).textContent = '×' + (+cs.value).toFixed(2).replace(/0$/, ''); $('#cprev', m).innerHTML = arrowSvg(+cs.value); };
    prev(); cs.oninput = prev; cs.onchange = () => save({ cursorSize: +cs.value });
  }
  if (tab === 'power') {
    $$('[data-pw]', m).forEach(b => { let armed = 0, label = b.textContent; b.onclick = () => {
      if (!armed) { armed = 1; b.textContent = T('confirm'); setTimeout(() => { armed = 0; b.textContent = label; }, 3000); } else api.power(b.dataset.pw); }; });
    $('#quit', m).onclick = () => api.quit();
  }
}
async function refreshRemote() {
  if (modalId !== 'settings' || !$('#pin')) return;
  const i = await api.remoteInfo();
  $('#qr').src = i.qr; $('#pin').textContent = i.pin; $('#rurl').textContent = i.url; $('#paired').textContent = `${T('pairedN')}: ${i.paired}`;
}

/* ---------- Navigation (Pfeiltasten / Fernbedienung) ---------- */
function move(dir) {
  const root = modalEl || document.body;
  const list = $$('[data-f]', root).filter(e => !e.disabled && e.getClientRects().length && (modalEl || !e.closest('.modal')));
  const cur = document.activeElement;
  if (!list.includes(cur)) { list[0]?.focus(); return; }
  const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best, bs = 1e9;
  for (const e of list) {
    if (e === cur) continue;
    const b = e.getBoundingClientRect(), dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
    const along = dir === 'Left' ? -dx : dir === 'Right' ? dx : dir === 'Up' ? -dy : dy, side = dir === 'Left' || dir === 'Right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 2) continue; const s = along + side * 3; if (s < bs) { bs = s; best = e; }
  }
  best?.focus();
}
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); return; }   // Strg+L wird global vom Hauptprozess behandelt
  if (editing && !modalEl && editKey(e)) return;
  const inArea = e.target.tagName === 'TEXTAREA';
  if (inArea) {
    const t = e.target, up = e.key === 'ArrowUp' && t.selectionStart === 0, down = e.key === 'ArrowDown' && t.selectionEnd === t.value.length;
    if (!(up || down) && e.key !== 'Escape') return;
    if (e.key === 'Escape') { t.blur(); return; }
  }
  const inInput = e.target.tagName === 'INPUT';
  if (e.key === 'Escape') { if (modalEl && modalId !== 'welcome') { e.preventDefault(); closeModal(); } return; }
  if (e.key.startsWith('Arrow')) {
    if (inInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    e.preventDefault(); move(e.key.slice(5));
  } else if (e.key === 'Enter') {
    if (e.defaultPrevented) return;
    e.preventDefault(); inInput ? (e.target.dataset.submit ? $(e.target.dataset.submit)?.click() : move('Down')) : e.target.dataset?.f && e.target.click();
  } else if ((e.key === 'ContextMenu' || e.key === 'Delete') && !modalEl && e.target.dataset?.id) {
    e.preventDefault(); options(cfg.apps.find(a => a.id === e.target.dataset.id));
  } else if ((e.key === 'ContextMenu' || e.key === 'Delete') && !modalEl && e.target.dataset?.q) {
    e.preventDefault(); quickOptions(cfg.quick.find(a => a.id === e.target.dataset.q));
  }
});
document.addEventListener('focusin', e => {
  if (e.target.dataset?.f) blip(480);
  if (e.target.closest?.('.dd')) e.target.scrollIntoView({ block: 'nearest' });
  const t = e.target.closest?.('.tile'); if (!t) return;
  const a = cfg.apps.find(x => x.id === t.dataset.id);
  a ? setBg(colorOf(a)) : setBg(...idleBg());
  if (!mouseFocus) centerTile(t);
  newsLayer();
});
let mouseFocus = false;
$('#row').addEventListener('mouseover', e => {
  const t = e.target.closest('.tile'); if (!t) return;
  hoverTile = t; newsLayer();
  if (document.activeElement !== t && !modalEl && !editing && performance.now() > navLock) { mouseFocus = true; t.focus({ preventScroll: true }); mouseFocus = false; }
});
$('#row').addEventListener('mouseout', e => { if (e.target.closest('.tile') && !e.relatedTarget?.closest?.('.tile')) { hoverTile = null; newsLayer(); } });

/* Mausrad: wie beim Apple TV nach unten/oben durch die Kachelreihen */
let wheelT = 0;
addEventListener('wheel', e => {
  if (modalEl || editing || Math.abs(e.deltaY) < 2 || e.target.closest?.('.modal, .wd, textarea')) return;
  e.preventDefault();
  const now = performance.now(); if (now - wheelT < 380) return; wheelT = now;
  if (!document.activeElement?.closest?.('.tile')) { $('.tile')?.focus(); return; }
  move(e.deltaY > 0 ? 'Down' : 'Up');
}, { passive: false });

/* News unten rechts liegen vor den Kacheln – sobald eine Kachel (Maus oder Fokus) sie berührt, kommt die Kachel nach vorn */
let hoverTile = null, usingMouse = false;
addEventListener('mousemove', () => { usingMouse = true; }, { passive: true });
addEventListener('keydown', () => { usingMouse = false; });
function newsLayer() {
  const n = $('#news'); if (!n || n.hidden) return;
  const t = modalEl ? null : usingMouse ? hoverTile : document.activeElement?.closest?.('.tile');
  let back = false;
  if (t) { const a = $('.card', t).getBoundingClientRect(), b = n.getBoundingClientRect(); back = a.right > b.left - 8 && a.left < b.right + 8 && a.bottom > b.top - 8 && a.top < b.bottom + 8; }
  n.classList.toggle('back', back);
}
$('#row').addEventListener('transitionend', e => { if (e.target.id === 'row') newsLayer(); });
document.addEventListener('focusout', () => setTimeout(newsLayer, 0));

/* ---------- Maus: Glanz, Neigung und Tiefe der Kacheln folgen dem Zeiger ---------- */
let mx = -1e4, my = -1e4, raf = 0, idleT;
function parallax() {
  raf = 0;
  for (const c of $$('.tile .card')) {
    const b = c.getBoundingClientRect(); if (b.right < -60 || b.left > innerWidth + 60) continue;
    const dx = (mx - (b.left + b.width / 2)) / b.width, dy = (my - (b.top + b.height / 2)) / b.height, k = Math.max(0, 1 - Math.hypot(dx, dy) / 3.2);
    c.style.setProperty('--rx', (-dy * 10 * k).toFixed(2) + 'deg'); c.style.setProperty('--ry', (dx * 12 * k).toFixed(2) + 'deg');
    c.style.setProperty('--ix', (dx * 14 * k).toFixed(1) + 'px'); c.style.setProperty('--iy', (dy * 10 * k).toFixed(1) + 'px');
    c.style.setProperty('--hx', (50 + dx * 45).toFixed(0) + '%'); c.style.setProperty('--hy', (50 + dy * 45).toFixed(0) + '%');
  }
}
const wake = () => { document.body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add('idle'), 3000); };
addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; wake(); if (!raf) raf = requestAnimationFrame(parallax); });
document.addEventListener('mouseleave', () => { mx = my = -1e4; if (!raf) raf = requestAnimationFrame(parallax); });
wake();


/* ---------- Konto ---------- */
const acc = () => cfg.account || { configured: false };
const personSvg = '<svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/></svg>';
function renderProfile() {
  const d = $('#dev'), a = acc();
  d.innerHTML = `<i class="av">${a.signedIn && a.username ? esc(a.username[0].toUpperCase()) : personSvg}</i><span>${esc(a.signedIn ? (a.username || T('accChoose')) : T('accGuest'))}</span>`;
}
const ERR = { nobackend: 'accNoBackend', badname: 'accBad', taken: 'accTaken', short: 'accShort', exists: 'accExists', wrong: 'accWrong', unconfirmed: 'accUnconf', timeout: 'accTimeout', err: 'accErr' };
const errMsg = r => T(ERR[r.error] || 'accErr') + (r.error === 'err' && r.detail ? ' (' + r.detail + ')' : '');
function mountAccount(host, o) {
  let mode = acc().needsUsername ? 'name' : 'register', msg = '', busy = false;
  const paint = () => {
    const a = acc();
    if (!a.configured) { host.innerHTML = `<p class="hint" style="font-size:1.15rem">${esc(T('accNoBackend'))}</p>`; return; }
    if (a.signedIn && a.username) { host.innerHTML = `<p class="sub" style="margin:.4rem 0">${esc(T('accHi'))} <b>${esc(a.username)}</b></p>`; return; }
    const f = (id, label, type, ph, extra = '') => `<label>${esc(T(label))}</label><input type="${type}" data-f id="${id}" placeholder="${esc(ph || '')}" autocomplete="off" ${extra}>`;
    const last = mode === 'name' ? '#au' : '#ap';
    host.innerHTML = (mode === 'name' ? '' : `<div class="seg"><button class="btn ${mode === 'register' ? 'on' : ''}" data-f data-am="register">${esc(T('accRegister'))}</button><button class="btn ${mode === 'login' ? 'on' : ''}" data-f data-am="login">${esc(T('accLogin'))}</button></div>`)
      + (mode !== 'login' ? f('au', 'accUser', 'text', 'name_123', `maxlength="20" data-submit="${mode === 'name' ? '#asub' : ''}"`) + `<div class="hint">${esc(T('accUserHint'))}</div>` : '')
      + (mode !== 'name' ? f('ae', 'accEmail', 'email', 'name@mail.de') + f('ap', 'accPass', 'password', '', 'data-submit="#asub"') : '')
      + `<div class="actions" style="justify-content:flex-start;margin-top:1.2rem"><button class="btn primary" data-f id="asub" ${busy ? 'disabled' : ''}>${esc(T(mode === 'login' ? 'accLogin' : mode === 'name' ? 'save' : 'accRegister'))}</button>${mode !== 'name' ? `<button class="btn" data-f id="agoogle" ${busy ? 'disabled' : ''}>G  ${esc(T('accGoogle'))}</button>` : ''}</div><div class="hint" id="amsg" style="min-height:1.4em">${esc(msg)}</div>`;
    $$('[data-am]', host).forEach(b => b.onclick = () => { mode = b.dataset.am; msg = ''; paint(); refocus$(host, mode === 'register' ? '#au' : '#ae'); });
    $('#asub', host).onclick = submit; if ($('#agoogle', host)) $('#agoogle', host).onclick = google;
  };
  const done = async r => {
    busy = false;
    if (r.error) { msg = errMsg(r); return paint(); }
    if (r.confirm) { mode = 'login'; msg = T('accConfirm'); return paint(); }
    cfg.account = r.state || (await api.acc.state()); renderProfile(); loadFriends();
    if (cfg.account.needsUsername) { mode = 'name'; msg = ''; return paint(); }
    paint(); o.onSuccess && o.onSuccess();
  };
  async function submit() {
    if (busy) return; const v = id => ($(id, host)?.value || '').trim();
    busy = true; msg = '…'; paint();
    done(mode === 'register' ? await api.acc.signUp({ username: v('#au'), email: v('#ae'), password: $('#ap', host).value })
      : mode === 'login' ? await api.acc.signIn({ email: v('#ae'), password: $('#ap', host).value }) : await api.acc.username(v('#au')));
  }
  async function google() { if (busy) return; busy = true; msg = T('accWait'); paint(); done(await api.acc.google()); }
  paint(); refocus$(host, mode === 'name' ? '#au' : '#au');
}
const refocus$ = (host, sel) => requestAnimationFrame(() => ($(sel, host) || $('[data-f]', host))?.focus());
function accountModal() {
  const a = acc();
  if (!a.signedIn || a.needsUsername) {
    const m = modal('acct', `<h2>${esc(T(a.needsUsername ? 'accChoose' : 'accCreate'))}</h2><div id="acct"></div><div class="actions"><button class="btn" data-f id="ax">${esc(T('close'))}</button></div>`, 'wide');
    mountAccount($('#acct', m), { onSuccess: closeModal }); $('#ax', m).onclick = closeModal; return;
  }
  const m = modal('acct', `<div class="prof"><i class="av big">${esc(a.username[0].toUpperCase())}</i><div><h2 style="margin:0">${esc(a.username)}</h2><div class="hint" style="margin:.2rem 0 0">${esc(a.user?.email || '')}</div></div></div>
    <div class="stack" style="margin-top:1.4rem"><button class="btn" data-f id="ash"></button><button class="btn primary" data-f id="afr">${esc(T('friends'))}</button><button class="btn danger" data-f id="aout">${esc(T('accOut'))}</button><button class="btn" data-f id="ax">${esc(T('close'))}</button></div>`);
  tog($('#ash', m), T('accShare'), () => cfg.shareActivity !== false, v => save({ shareActivity: v }));
  $('#afr', m).onclick = () => friendsModal('friends');
  let sure = false; $('#aout', m).onclick = async e => { if (!sure) { sure = true; e.target.textContent = T('sure'); return; } cfg.account = await api.acc.signOut(); FR = null; renderProfile(); badge(); closeModal(); };
  $('#ax', m).onclick = closeModal;
}
$('#dev').onclick = accountModal;

/* ---------- Freunde ---------- */
let FR = null, frTab = 'friends', frT = 0, searchT = 0;
const badge = () => { const n = FR?.incoming?.length || 0, b = $('#friendsBtn .bd'); b.hidden = !n; b.textContent = n; };
async function loadFriends() {
  const a = acc(); if (!a.signedIn || !a.username) { FR = null; badge(); return; }
  const r = await api.acc.friends(); if (!r || r.error) return;
  const changed = JSON.stringify(r) !== JSON.stringify(FR); FR = r; badge();
  if (changed && modalId === 'friends' && frTab !== 'add') friendsModal(frTab, true);
}
const statusOf = f => f.online ? (f.activity ? `${T('fOnline')} <b>${esc(f.activity)}</b>` : esc(T('fIdle'))) : esc(T('fOffline'));
const frRow = (name, sub, btns, on) => `<div class="fr"><i class="av ${on ? 'on' : ''}">${esc((name[0] || '?').toUpperCase())}</i><div><b>${esc(name)}</b><small>${sub}</small></div>${btns}</div>`;
function friendsModal(tab = 'friends', quiet) {
  frTab = tab; const a = acc();
  if (!a.signedIn || !a.username) {
    const m = modal('friends', `<h2>${esc(T('friends'))}</h2><p class="sub">${esc(T('fNeedLogin'))}</p><div class="actions"><button class="btn" data-f id="fx">${esc(T('close'))}</button><button class="btn primary" data-f id="fl">${esc(T('accGuest'))}</button></div>`);
    $('#fx', m).onclick = closeModal; $('#fl', m).onclick = accountModal; return;
  }
  const f = FR || { friends: [], incoming: [], outgoing: [] }, keep = modalId === 'friends' ? $('.sh-body', modalEl)?.scrollTop || 0 : 0, af = quiet && document.activeElement?.dataset ? document.activeElement.dataset : null;
  let body = '';
  if (tab === 'friends') body = f.friends.length ? f.friends.map(x => frRow(x.username, statusOf(x), `<button class="btn danger sm" data-f data-fx="${x.fid}">×</button>`, x.online)).join('') : `<p class="hint">${esc(T('fNone'))}</p>`;
  if (tab === 'requests') body = (f.incoming.length ? f.incoming.map(x => frRow(x.username, esc(T('fReqIn')), `<button class="btn primary sm" data-f data-fa="${x.fid}">${esc(T('fAccept'))}</button><button class="btn sm" data-f data-fx="${x.fid}">${esc(T('fDecline'))}</button>`)).join('') : '')
    + (f.outgoing.length ? `<label>${esc(T('fPending'))}</label>` + f.outgoing.map(x => frRow(x.username, esc(T('fPending')), `<button class="btn sm" data-f data-fx="${x.fid}">${esc(T('cancel'))}</button>`)).join('') : '')
    || `<p class="hint">${esc(T('fNoReq'))}</p>`;
  if (tab === 'add') body = `<input type="text" data-f id="fs" placeholder="${esc(T('fSearchPh'))}" maxlength="20" autocomplete="off"><div id="fres" style="margin-top:1rem"></div>`;
  const n = f.incoming.length;
  const m = modal('friends', `<div class="sh-head"><h2>${esc(T('friends'))}</h2><div class="seg tabs">${[['friends', T('friends')], ['requests', T('fReq') + (n ? ` (${n})` : '')], ['add', T('fAdd')]].map(([k, l]) => `<button class="btn ${k === tab ? 'on' : ''}" data-f data-ft="${k}">${esc(l)}</button>`).join('')}</div></div><div class="sh-body">${body}</div><div class="sh-foot"><button class="btn primary" data-f id="fdone">${esc(T('done'))}</button></div>`, 'wide settings');
  if (keep) $('.sh-body', m).scrollTop = keep;
  $$('[data-ft]', m).forEach(b => b.onclick = () => { friendsModal(b.dataset.ft); refocus(`[data-ft="${b.dataset.ft}"]`); });
  $('#fdone', m).onclick = closeModal;
  $$('[data-fx]', m).forEach(b => b.onclick = async () => { await api.acc.remove(+b.dataset.fx); await loadFriends(); friendsModal(tab); });
  $$('[data-fa]', m).forEach(b => b.onclick = async () => { await api.acc.accept(+b.dataset.fa); await loadFriends(); friendsModal(tab); });
  if (af && af.ft) refocus(`[data-ft="${af.ft}"]`);
  if (tab === 'add') {
    const fs = $('#fs', m), res = $('#fres', m);
    fs.oninput = () => { clearTimeout(searchT); searchT = setTimeout(async () => {
      const q = fs.value.trim(); if (q.length < 2) { res.innerHTML = ''; return; }
      const list = await api.acc.search(q), have = new Set([...(FR?.friends || []), ...(FR?.outgoing || []), ...(FR?.incoming || [])].map(x => x.username));
      res.innerHTML = Array.isArray(list) && list.length ? list.map(x => frRow(x.username, '', have.has(x.username) ? `<span class="hint" style="margin:0">${esc(T('fPending'))}</span>` : `<button class="btn primary sm" data-f data-fadd="${esc(x.username)}">${esc(T('fAdd'))}</button>`)).join('') : `<p class="hint">${esc(T('fNoRes'))}</p>`;
      $$('[data-fadd]', res).forEach(b => b.onclick = async () => { b.disabled = true; const r = await api.acc.add(b.dataset.fadd); b.textContent = r.error ? T('accErr') : T('fSent'); loadFriends(); });
    }, 300); };
    refocus('#fs');
  }
}
$('#friendsBtn').onclick = () => friendsModal('friends');
clearInterval(frT); frT = setInterval(() => loadFriends(), 10000);

/* ---------- News-Ticker unten rechts ---------- */
let NEWS = [], newsI = 0;
async function loadNews() { try { NEWS = await api.news(); if (!Array.isArray(NEWS)) NEWS = []; } catch { NEWS = []; } newsI = 0; paintNews(); }
function paintNews() {
  const n = $('#news'); n.hidden = !NEWS.length; if (!NEWS.length) return;
  n.innerHTML = NEWS.map((p, i) => `<div class="ns ${i === newsI ? 'on' : ''}"><span class="nt">${esc(p.tag || T('newsTag'))}</span><b>${esc(p.title)}</b><p>${esc(p.summary || '')}</p></div>`).join('')
    + `<div class="nd">${NEWS.map((_, i) => `<i class="${i === newsI ? 'on' : ''}"></i>`).join('')}</div><i class="np"></i>`;
  const np = $('.np', n); np.onanimationend = nextNews;
}
function nextNews() {
  if (NEWS.length < 2) return;
  if (modalEl || editing) { const np = $('#news .np'); if (np) { np.style.animation = 'none'; void np.offsetWidth; np.style.animation = ''; } return; }
  newsI = (newsI + 1) % NEWS.length;
  $$('#news .ns').forEach((e, i) => e.classList.toggle('on', i === newsI)); $$('#news .nd i').forEach((e, i) => e.classList.toggle('on', i === newsI));
  const np = $('#news .np'); np.style.animation = 'none'; void np.offsetWidth; np.style.animation = '';
}
function fmtBody(t) {
  let h = '', ul = false;
  for (const l of String(t || '').split(/\r?\n/)) {
    if (/^\s*[-•*]\s+/.test(l)) { if (!ul) { h += '<ul>'; ul = true; } h += `<li>${esc(l.replace(/^\s*[-•*]\s+/, ''))}</li>`; }
    else { if (ul) { h += '</ul>'; ul = false; } if (l.trim()) h += `<p>${esc(l)}</p>`; }
  }
  return h + (ul ? '</ul>' : '');
}
function openPost(p) {
  if (!p) return;
  const d = p.created_at ? new Date(p.created_at).toLocaleDateString(cfg.lang, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const m = modal('post', `<div class="post"><span class="nt">${esc(p.tag || T('newsTag'))}</span> <span class="hint" style="margin:0 0 0 .6rem">${esc(d)}</span><h2 style="margin-top:.6rem">${esc(p.title)}</h2>${/^https:\/\//.test(p.image_url || '') ? `<img src="${esc(p.image_url)}" alt="">` : ''}<div class="pb">${fmtBody(p.body || p.summary)}</div></div><div class="actions"><button class="btn primary" data-f id="px">${esc(T('close'))}</button></div>`, 'wide');
  $('#px', m).onclick = closeModal;
}
$('#news').onclick = () => openPost(NEWS[newsI]);

/* ---------- Großer Mauszeiger im Fernbedienungsmodus ---------- */
const arrowSvg = sz => `<svg viewBox="0 0 24 24" width="${(22 * sz).toFixed(0)}" height="${(22 * sz).toFixed(0)}"><path d="M4 2.5v17l4.6-4.2 3.1 6.7 3-1.4-3.1-6.6 6.4-.3z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
let bcSize = 2;
function setBigCursor(on, size) {
  const bc = $('#bigcur'); bcSize = size || 2; document.body.classList.toggle('bigcursor', !!on); bc.hidden = !on;
  if (on) bc.innerHTML = arrowSvg(bcSize);
}
addEventListener('mousemove', e => { const bc = $('#bigcur'); if (!bc.hidden) bc.style.transform = `translate3d(${e.clientX - 3.7 * bcSize}px,${e.clientY - 2.3 * bcSize}px,0)`; }, { passive: true });

/* ---------- Updates ---------- */
let UPDS = { state: 'idle' };
function updText(u) {
  return { checking: T('updChecking'), latest: T('updLatest'), downloading: `${T('updDown')} ${u.percent || 0} %`, ready: `${T('updReady')} (v${u.next})`, manual: `${T('updNew')} (v${u.next})`, error: T('updErr') }[u.state] || '';
}
function paintUpd() {
  const b = $('#upd'), ok = UPDS.state === 'ready' || UPDS.state === 'manual';
  b.hidden = !ok; if (ok) b.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg><span>${esc(UPDS.state === 'ready' ? T('updRestart') : T('updGet'))}</span>`;
  const l = $('#updline'); if (l) l.textContent = updText(UPDS);
}
$('#upd').onclick = () => api.update.install();
api.on('update', u => { UPDS = u; paintUpd(); });

/* ---------- Start ---------- */
api.on('apps', d => {
  const old = new Set(cfg.apps.map(a => a.id)), fid = document.activeElement?.dataset?.id;
  cfg.apps = d.apps; cfg.quick = d.quick; cfg.running = d.running; render(); renderQuick();
  if (modalId === 'settings' && $('.qrow, #qa', modalEl)) settings('quick');
  const nw = d.apps.find(a => !old.has(a.id)), target = nw ? nw.id : fid;
  if (!modalEl) ($(`.tile[data-id="${target}"]`) || $('.tile'))?.focus();
});
api.on('running', ids => { cfg.running = ids; render(); });
api.on('launching', a => launching(a));
api.on('home', () => { launchReset(); render(); setTimeout(() => { if (!modalEl) ($('.tile.add') && $$('.tile')[0])?.focus(); }, 60); });
api.on('account', st => { cfg.account = st; renderProfile(); loadFriends(); });
api.on('remoteMode', d => setBigCursor(d.on, d.size));
api.on('remote', d => { cfg.paired = d.paired; pill(); refreshRemote(); });
$('#gear').onclick = () => settings(); $('#pill').onclick = () => settings('remote'); $('#wheel').onclick = () => api.menu();
(async () => {
  cfg = await api.config();
  applyTheme(); applyLang(); wallStart(); setInterval(tick, 1000); setInterval(weather, 9e5);
  loadNews(); setInterval(loadNews, 9e5); loadFriends();
  UPDS = cfg.update || UPDS; paintUpd();
  $('.tile')?.focus();
  if (!cfg.onboarded) welcome(0);
})();
