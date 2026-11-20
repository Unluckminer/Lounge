/* Liquid Glass: Jedes Element mit der Klasse .glass bekommt einen eigenen SVG-Filter, der den Hintergrund an den Rändern
   wie durch eine Glaslinse bricht (feDisplacementMap). Je tiefer ein Glas im Stapel liegt (Fenster über Seite, Karte im Fenster),
   desto stärker die Brechung. Die Verschiebungskarte wird passend zu Größe und Rundung des Elements gezeichnet. */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const defs = document.getElementById('lg-defs');
  const SCALE = [0, 38, 62, 84];        // maximale Verschiebung in px je Tiefe (Tiefe 1..3)
  let seq = 0;
  const info = new WeakMap();

  const depthOf = el => { let d = 1, p = el.parentElement; while (p) { if (p.classList && p.classList.contains('glass')) d++; p = p.parentElement; } return Math.min(d, 3); };
  const radiusOf = (el, w, h) => {
    const s = getComputedStyle(el).borderTopLeftRadius || '0';
    const r = s.endsWith('%') ? parseFloat(s) / 100 * Math.min(w, h) : parseFloat(s) || 0;
    return Math.min(r, Math.min(w, h) / 2);
  };
  function mapURL(w, h, r, bezel) {
    const k = w * h > 400000 ? .35 : .5, W = Math.max(4, Math.round(w * k)), H = Math.max(4, Math.round(h * k));
    const R = Math.min(r * k, W / 2, H / 2), B = Math.max(3, bezel * k);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const px = x + .5 - W / 2, py = y + .5 - H / 2;
      const qx = Math.abs(px) - (W / 2 - R), qy = Math.abs(py) - (H / 2 - R);
      const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)), inn = Math.min(Math.max(qx, qy), 0);
      const depth = -(out + inn - R);           // Abstand zum Rand nach innen
      let vx = 0, vy = 0;
      if (depth < B) {
        let nx, ny;
        if (qx > 0 || qy > 0) { nx = Math.sign(px) * Math.max(qx, 0); ny = Math.sign(py) * Math.max(qy, 0); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; }
        else if (qx > qy) { nx = Math.sign(px) || 1; ny = 0; } else { nx = 0; ny = Math.sign(py) || 1; }
        const t = 1 - Math.max(depth, 0) / B, m = 1 - Math.sqrt(1 - t * t * .98);   // Linsenprofil: sanft innen, stark am Rand
        vx = -nx * m; vy = -ny * m;
      }
      const i = (y * W + x) * 4; d[i] = 128 + vx * 127; d[i + 1] = 128 + vy * 127; d[i + 2] = 128; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); return c.toDataURL('image/png');
  }
  function build(el) {
    const st = info.get(el); if (!st) return;
    const w = el.offsetWidth, h = el.offsetHeight; if (w < 6 || h < 6) return;
    const dep = depthOf(el), r = radiusOf(el, w, h), key = [w, h, Math.round(r), dep].join('/');
    if (st.key === key) return; st.key = key;
    el.dataset.d = dep;
    const bezel = Math.max(10, Math.min(Math.min(w, h) * .26, 30 + dep * 8));
    st.img.setAttribute('href', mapURL(w, h, r, bezel)); st.img.setAttribute('width', w); st.img.setAttribute('height', h);
    st.disp.setAttribute('scale', SCALE[dep] * (bezel / 36 > 1 ? 1 : .8));
  }
  const queue = new Set(); let raf = 0;
  const schedule = el => { queue.add(el); if (!raf) raf = requestAnimationFrame(() => { raf = 0; const q = [...queue]; queue.clear(); q.forEach(build); }); };
  const ro = new ResizeObserver(es => es.forEach(e => schedule(e.target)));
  function reg(el) {
    if (info.has(el)) return;
    const id = 'lg' + (++seq), f = document.createElementNS(NS, 'filter');
    f.setAttribute('id', id); f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '100%'); f.setAttribute('height', '100%');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    const img = document.createElementNS(NS, 'feImage'); img.setAttribute('x', '0'); img.setAttribute('y', '0'); img.setAttribute('preserveAspectRatio', 'none'); img.setAttribute('result', 'm');
    const disp = document.createElementNS(NS, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic'); disp.setAttribute('in2', 'm'); disp.setAttribute('xChannelSelector', 'R'); disp.setAttribute('yChannelSelector', 'G'); disp.setAttribute('scale', '0');
    f.append(img, disp); defs.append(f);
    info.set(el, { id, f, img, disp, key: '' });
    el.style.setProperty('--lg', `url(#${id})`);
    ro.observe(el); schedule(el);
  }
  function unreg(el) { const st = info.get(el); if (!st) return; st.f.remove(); ro.unobserve(el); info.delete(el); }
  const each = (n, fn) => { if (n.nodeType !== 1) return; if (n.matches('.glass')) fn(n); n.querySelectorAll('.glass').forEach(fn); };
  new MutationObserver(ms => ms.forEach(m => { m.addedNodes.forEach(n => each(n, reg)); m.removedNodes.forEach(n => each(n, unreg)); }))
    .observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('.glass').forEach(reg);
  window.Liquid = { refresh: () => document.querySelectorAll('.glass').forEach(schedule) };
})();
