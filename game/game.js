/* Salão dos Ecos — sala de testes no estilo Symphony of the Night.
 * Canvas 2D puro, sem bibliotecas. Resolução interna 640x360, sala de 1280x360.
 * Sprites: assets/atlas.png + window.ATLAS (gerados por tools/extract.py).
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- constantes
  const W = 640, H = 360, T = 20, COLS = 64, ROWS = 18;
  const ROOM_W = COLS * T, ROOM_H = ROWS * T;
  const DT = 1 / 60;
  const GRAV = 1500, MAX_FALL = 620;
  const PIXEL_FONT = '"Silkscreen", ui-monospace, monospace';
  const GOTHIC_FONT = '"Pirata One", Georgia, serif';

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const ATLAS = window.ATLAS;
  const atlasImg = new Image();

  // ---------------------------------------------------------------- utilidades
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function rng(seed) { // mulberry32: texturas determinísticas
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // ---------------------------------------------------------------- mapa
  // 0 vazio · 1 pedra · 2 grade (só a névoa passa) · 3 plataforma (atravessa por baixo)
  const map = new Uint8Array(COLS * ROWS);
  const fill = (x0, y0, x1, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map[y * COLS + x] = v; };
  function buildMap() {
    map.fill(0);
    fill(0, 0, COLS - 1, 0, 1);          // teto
    fill(0, 16, COLS - 1, 17, 1);        // chão
    fill(0, 0, 1, 17, 1);                // parede esquerda
    fill(COLS - 2, 0, COLS - 1, 17, 1);  // parede direita
    fill(7, 13, 11, 13, 3);              // degraus para treinar pulo
    fill(12, 10, 15, 10, 3);
    fill(7, 5, 10, 5, 3);                // só com pulo duplo
    fill(26, 5, 30, 5, 3);               // só com super salto
    fill(33, 3, 38, 3, 1);               // nicho do morcego (40px de altura)
    fill(42, 1, 45, 12, 1);              // túnel baixo: só o lobo passa
    fill(52, 1, 52, 15, 2);              // grade de ferro: só a névoa passa
  }
  const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) ? 1 : map[ty * COLS + tx];
  function solidFor(e, tx, ty) {
    const v = tileAt(tx, ty);
    return v === 1 || (v === 2 && e.form !== 'mist');
  }

  // ---------------------------------------------------------------- entrada
  const KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    KeyZ: 'jump', Space: 'jump', KeyX: 'attack', KeyC: 'tk', KeyV: 'block', KeyA: 'aura',
    KeyS: 'sjump', ShiftLeft: 'dash', ShiftRight: 'dash', KeyD: 'dash',
    Digit1: 'mist', Digit2: 'bat', Digit3: 'wolf', Numpad1: 'mist', Numpad2: 'bat', Numpad3: 'wolf',
    Enter: 'pause', Escape: 'pause', KeyM: 'mute', KeyR: 'reset',
  };
  const held = new Set(), touchHeld = new Set(), padHeld = new Set();
  let pressedQ = new Set();
  const down = k => held.has(k) || touchHeld.has(k) || padHeld.has(k);
  let pressed = new Set();
  function press(k) { pressedQ.add(k); }

  addEventListener('keydown', e => {
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    audio.unlock();
    if (!e.repeat) press(k);
    held.add(k);
  });
  addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) held.delete(k); });
  addEventListener('blur', () => { held.clear(); touchHeld.clear(); });

  // toque
  if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.getElementById('wrap').classList.add('touch');
  document.querySelectorAll('.pad button').forEach(b => {
    const k = b.dataset.k;
    const on = e => { e.preventDefault(); audio.unlock(); b.setPointerCapture?.(e.pointerId); press(k); touchHeld.add(k); b.classList.add('on'); };
    const off = e => { e.preventDefault(); touchHeld.delete(k); b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('contextmenu', e => e.preventDefault());
  });

  // controle (gamepad padrão)
  const PAD_BTNS = { 0: 'jump', 2: 'attack', 3: 'tk', 1: 'block', 4: 'dash', 5: 'aura', 6: 'sjump', 7: 'sjump', 9: 'pause', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  let padPrev = new Set();
  function pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(Boolean);
    padHeld.clear();
    if (!gp) return;
    for (const [i, k] of Object.entries(PAD_BTNS)) if (gp.buttons[i]?.pressed) padHeld.add(k);
    if (gp.axes[0] < -0.5) padHeld.add('left');
    if (gp.axes[0] > 0.5) padHeld.add('right');
    if (gp.axes[1] < -0.6) padHeld.add('up');
    if (gp.axes[1] > 0.6) padHeld.add('down');
    for (const k of padHeld) if (!padPrev.has(k)) press(k);
    padPrev = new Set(padHeld);
  }

  // ---------------------------------------------------------------- áudio (sintetizado)
  const audio = (() => {
    let ac = null, master = null, muted = false;
    function unlock() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = 0.35; master.connect(ac.destination);
      } catch { ac = null; }
    }
    function tone(type, f0, f1, dur, vol = 0.3, delay = 0) {
      if (!ac || muted) return;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol = 0.3, freq = 1200, q = 0.8) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = ac.createBufferSource(); s.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain(); g.gain.value = vol;
      s.connect(f); f.connect(g); g.connect(master); s.start(t);
    }
    const sfx = {
      jump: () => tone('square', 220, 440, 0.12, 0.12),
      djump: () => { tone('square', 330, 660, 0.1, 0.1); tone('triangle', 660, 990, 0.12, 0.08, 0.05); },
      swish: () => noise(0.16, 0.35, 2400, 1.2),
      hit: () => { tone('square', 160, 60, 0.12, 0.25); noise(0.08, 0.3, 900); },
      block: () => { tone('triangle', 1400, 900, 0.15, 0.2); tone('square', 2100, 1800, 0.05, 0.08); },
      break: () => noise(0.3, 0.4, 600, 0.6),
      pickup: () => { tone('square', 660, 660, 0.06, 0.1); tone('square', 990, 990, 0.08, 0.1, 0.06); },
      morph: () => { tone('sawtooth', 120, 600, 0.45, 0.12); noise(0.4, 0.2, 400); },
      unmorph: () => { tone('sawtooth', 600, 120, 0.4, 0.12); noise(0.35, 0.2, 400); },
      burst: () => { tone('sawtooth', 90, 40, 0.35, 0.3); noise(0.35, 0.4, 300, 0.5); },
      aura: () => { tone('sawtooth', 70, 140, 0.6, 0.15); noise(0.6, 0.15, 500); },
      howl: () => { tone('sawtooth', 300, 520, 0.35, 0.1); tone('sawtooth', 520, 380, 0.5, 0.1, 0.35); },
      fire: () => { tone('square', 500, 200, 0.12, 0.08); noise(0.1, 0.15, 1500); },
      tk: () => { tone('triangle', 400, 1200, 0.25, 0.1); noise(0.25, 0.25, 3000, 2); },
      hurt: () => { tone('square', 300, 80, 0.25, 0.25); },
      deny: () => tone('square', 140, 120, 0.15, 0.15),
    };
    return {
      unlock, sfx,
      play(n) { sfx[n]?.(); },
      toggle() { muted = !muted; return muted; },
      get muted() { return muted; },
    };
  })();

  // ---------------------------------------------------------------- desenho de sprites
  const fr = (name, i) => { const a = ATLAS[name]; return a[((i % a.length) + a.length) % a.length]; };
  const tintCv = mkCanvas(8, 8), tintCtx = tintCv.getContext('2d');

  /** Desenha um quadro do atlas com o ponto-âncora em (x, y) da tela. */
  function drawFrame(c, f, x, y, face, o = {}) {
    c.save();
    c.translate(Math.round(x), Math.round(y));
    if (o.alpha !== undefined) c.globalAlpha = o.alpha;
    if (o.comp) c.globalCompositeOperation = o.comp;
    if (o.rot) { c.translate(0, -(o.pivot || 0)); c.rotate(o.rot * face); c.translate(0, o.pivot || 0); }
    if (face < 0) c.scale(-1, 1);
    if (o.sx || o.sy) c.scale(o.sx || 1, o.sy || 1);
    let src = atlasImg, sx = f.x, sy = f.y;
    if (o.tint) {
      tintCv.width = f.w; tintCv.height = f.h;
      tintCtx.drawImage(atlasImg, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      tintCtx.globalCompositeOperation = 'source-atop';
      tintCtx.fillStyle = o.tint;
      tintCtx.fillRect(0, 0, f.w, f.h);
      tintCtx.globalCompositeOperation = 'source-over';
      src = tintCv; sx = 0; sy = 0;
    }
    c.drawImage(src, sx, sy, f.w, f.h, -f.ax, -f.ay, f.w, f.h);
    c.restore();
  }

  /** Pixel art a partir de texto: cada caractere é uma cor da paleta. */
  function pixelSprite(rows, pal, scale = 1) {
    const c = mkCanvas(rows[0].length * scale, rows.length * scale), g = c.getContext('2d');
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x * scale, y * scale, scale, scale); } }));
    return c;
  }
  const SKULL_ROWS = [
    '....bbbb....',
    '..bwwwwwwb..',
    '.bwwwwwwwwb.',
    'bwwwwwwwwwwb',
    'bwkkwwwwkkwb',
    'bkrrkwwkrrkb',
    'bwkkwwwwkkwb',
    'bwwwwkkwwwwb',
    '.bwwwkkwwwb.',
    '..bwwwwwwb..',
    '..bkwkwkwb..',
    '...bwwwwb...',
  ];
  const SKULL = pixelSprite(SKULL_ROWS, { b: '#3b3346', w: '#e9e1cf', k: '#1a1222', r: '#ff3b4e' }, 2);
  const SKULL_P = pixelSprite(SKULL_ROWS, { b: '#5a1020', w: '#f2c4c4', k: '#2a0610', r: '#ff2030' }, 2); // possuída
  const HEART = pixelSprite([
    '.rr.rr.',
    'rRrrrrr',
    'rrrrrrr',
    '.rrrrr.',
    '..rrr..',
    '...r...',
  ], { r: '#d1203a', R: '#ff9aa6' }, 1);
  const POTION = pixelSprite([
    '..cc..',
    '..gg..',
    '.gwwg.',
    'gwrrrg',
    'grrrrg',
    'grrrrg',
    '.gggg.',
  ], { c: '#8a6a3a', g: '#b9c7d8', w: '#ffffff', r: '#c4203b' }, 1);
  const ORB = pixelSprite([
    '.bbb.',
    'bwBBb',
    'bBBBb',
    'bBBBb',
    '.bbb.',
  ], { b: '#1d4f9a', B: '#48a8f0', w: '#e8f6ff' }, 1);

  // esqueleto: tronco + duas poses de pernas (andar)
  const SKEL_TOP = [
    '.....wwww.....',
    '....wwwwww....',
    '....wkwwkw....',
    '....wrwwrw....',
    '....wwwwww....',
    '.....wkkw.....',
    '.....wwww.....',
    '......ww......',
    '...swwwwwws...',
    '...w.wsws.w...',
    '...w.wsws.w...',
    '...w.wwww.w...',
    '..ww.swws.ww..',
    '......ww......',
    '......ww......',
    '....swwwws....',
    '....w....w....',
  ];
  const SKEL_LEGS = [[
    '....w....w....',
    '....w....w....',
    '....ww...ww...',
    '....w.....w...',
    '....w.....w...',
    '...ww....ww...',
    '..www...www...',
  ], [
    '.....w..w.....',
    '.....w..w.....',
    '.....ww.w.....',
    '......w.w.....',
    '......w.ww....',
    '.....ww..w....',
    '....www.www...',
  ]];
  const SKEL = SKEL_LEGS.map(l => pixelSprite(SKEL_TOP.concat(l), { w: '#e9e1cf', s: '#9a917f', k: '#1a1222', r: '#8a2030' }, 3));
  const SKEL_P = SKEL_LEGS.map(l => pixelSprite(SKEL_TOP.concat(l), { w: '#f2c4c4', s: '#a0485a', k: '#2a0610', r: '#ff2030' }, 3));

  // ---------------------------------------------------------------- cenário pré-renderizado
  const sky = mkCanvas(900, H), wall = mkCanvas(ROOM_W, ROOM_H), front = mkCanvas(ROOM_W, ROOM_H);
  const WINDOWS = [250, 430, 1090];          // x da esquerda de cada janela (56px de largura)
  const WIN_TOP = 64, WIN_BOT = 232, WIN_W = 56;
  const COLUMNS = [370, 800, 1212];

  function renderSky() {
    const g = sky.getContext('2d'), r = rng(7);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#06051a'); grd.addColorStop(0.45, '#1b1238'); grd.addColorStop(0.7, '#3a1a3f'); grd.addColorStop(1, '#14091a');
    g.fillStyle = grd; g.fillRect(0, 0, sky.width, H);
    for (let i = 0; i < 260; i++) {
      const b = r();
      g.fillStyle = b > 0.94 ? '#fff7e0' : b > 0.7 ? '#b8b0d8' : '#6a6290';
      g.fillRect(Math.floor(r() * sky.width), Math.floor(r() * 220), 1, 1);
    }
    // lua
    const mx = 470, my = 112, mr = 38;
    const glow = g.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3.2);
    glow.addColorStop(0, 'rgba(255,236,200,.35)'); glow.addColorStop(1, 'rgba(255,236,200,0)');
    g.fillStyle = glow; g.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
    g.fillStyle = '#f3e8cc'; g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d9c9a5';
    [[-12, -8, 7], [10, 6, 9], [-4, 16, 5], [16, -14, 4], [-20, 10, 4]].forEach(([dx, dy, rr]) => { g.beginPath(); g.arc(mx + dx, my + dy, rr, 0, Math.PI * 2); g.fill(); });
    // nuvens finas
    g.fillStyle = 'rgba(20,10,40,.75)';
    for (let i = 0; i < 9; i++) { const y = 70 + i * 13 + r() * 6; g.fillRect(Math.floor(r() * 700), Math.floor(y), 80 + Math.floor(r() * 180), 3); }
    // silhuetas do castelo ao longe
    g.fillStyle = '#0d0a1c';
    let x = 0;
    while (x < sky.width) {
      const w = 18 + Math.floor(r() * 34), top = 150 + Math.floor(r() * 60);
      g.fillRect(x, top, w, H - top);
      if (r() > 0.4) { // torre com telhado pontudo
        g.beginPath(); g.moveTo(x - 2, top); g.lineTo(x + w / 2, top - 18 - r() * 20); g.lineTo(x + w + 2, top); g.fill();
      }
      for (let k = 0; k < 3; k++) if (r() > 0.55) { g.fillStyle = '#e8a640'; g.fillRect(x + 4 + Math.floor(r() * (w - 8)), top + 10 + Math.floor(r() * 40), 2, 3); g.fillStyle = '#0d0a1c'; }
      x += w + Math.floor(r() * 10);
    }
  }

  function archPath(g, x, top, w, bot) {
    g.beginPath();
    g.moveTo(x, bot); g.lineTo(x, top + w / 2);
    g.arc(x + w / 2, top + w / 2, w / 2, Math.PI, 0);
    g.lineTo(x + w, bot); g.closePath();
  }

  function renderWall() {
    const g = wall.getContext('2d'), r = rng(42);
    // tijolos
    g.fillStyle = '#100d1b'; g.fillRect(0, 0, ROOM_W, ROOM_H);
    const bricks = ['#2a2540', '#2e2946', '#27223b', '#322c4b', '#2b2442'];
    for (let by = 0; by < ROOM_H; by += 10) {
      const off = (by / 10) % 2 ? 10 : 0;
      for (let bx = -off; bx < ROOM_W; bx += 20) {
        g.fillStyle = bricks[Math.floor(r() * bricks.length)];
        g.fillRect(bx + 1, by + 1, 18, 8);
        g.fillStyle = 'rgba(120,110,170,.18)'; g.fillRect(bx + 1, by + 1, 18, 1);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(bx + 1, by + 8, 18, 1);
        if (r() > 0.93) { g.fillStyle = '#1a1629'; g.fillRect(bx + 3 + Math.floor(r() * 12), by + 2, 1, 5); }
      }
    }
    for (let i = 0; i < 1800; i++) { g.fillStyle = r() > 0.5 ? 'rgba(0,0,0,.25)' : 'rgba(150,140,200,.08)'; g.fillRect(Math.floor(r() * ROOM_W), Math.floor(r() * ROOM_H), 1, 1); }
    // escurece para o teto
    let grd = g.createLinearGradient(0, 0, 0, ROOM_H);
    grd.addColorStop(0, 'rgba(5,3,12,.75)'); grd.addColorStop(0.45, 'rgba(5,3,12,.15)'); grd.addColorStop(1, 'rgba(5,3,12,.35)');
    g.fillStyle = grd; g.fillRect(0, 0, ROOM_W, ROOM_H);

    // lambri (painel inferior) com friso dourado
    g.fillStyle = '#1a1428'; g.fillRect(0, 252, ROOM_W, 68);
    for (let px = 8; px < ROOM_W; px += 64) {
      g.fillStyle = '#231b35'; g.fillRect(px, 262, 52, 50);
      g.fillStyle = '#120d1d'; g.fillRect(px, 311, 52, 1); g.fillRect(px + 51, 262, 1, 50);
      g.fillStyle = '#3a2f55'; g.fillRect(px, 262, 52, 1); g.fillRect(px, 262, 1, 50);
      g.fillStyle = '#2b2142'; g.fillRect(px + 20, 280, 12, 14);
    }
    g.fillStyle = '#8f6f2c'; g.fillRect(0, 250, ROOM_W, 2);
    g.fillStyle = '#d6b25e'; g.fillRect(0, 250, ROOM_W, 1);
    g.fillStyle = '#0b0814'; g.fillRect(0, 252, ROOM_W, 2);

    // janelas góticas (vazadas: o céu aparece por trás)
    for (const wx of WINDOWS) {
      g.save(); g.globalCompositeOperation = 'destination-out';
      archPath(g, wx, WIN_TOP, WIN_W, WIN_BOT); g.fill(); g.restore();
      g.lineWidth = 6; g.strokeStyle = '#3d3559'; archPath(g, wx - 3, WIN_TOP - 3, WIN_W + 6, WIN_BOT + 3); g.stroke();
      g.lineWidth = 1; g.strokeStyle = '#6c6094'; archPath(g, wx - 6, WIN_TOP - 6, WIN_W + 12, WIN_BOT + 6); g.stroke();
      g.fillStyle = '#2a2340'; // mainel e travessa
      g.fillRect(wx + WIN_W / 2 - 2, WIN_TOP + 18, 4, WIN_BOT - WIN_TOP - 18);
      g.fillRect(wx, 150, WIN_W, 4);
      g.strokeStyle = '#2a2340'; g.lineWidth = 3;
      g.beginPath(); g.arc(wx + WIN_W / 2, WIN_TOP + 26, 11, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#4b4170'; g.fillRect(wx - 8, WIN_BOT + 3, WIN_W + 16, 6); // peitoril
      g.fillStyle = '#6c6094'; g.fillRect(wx - 8, WIN_BOT + 3, WIN_W + 16, 1);
      // cortinas de veludo
      for (const side of [-1, 1]) {
        const cx = side < 0 ? wx - 18 : wx + WIN_W + 2;
        for (let i = 0; i < 16; i++) {
          const shade = i % 4 === 0 ? '#3d0a16' : i % 4 === 2 ? '#7a1426' : '#5a0f1d';
          g.fillStyle = shade;
          const sway = Math.round(Math.sin(i * 0.9) * 1);
          g.fillRect(cx + i + sway, WIN_TOP - 20, 1, 200 + (i % 3) * 3);
        }
        g.fillStyle = '#c9a24d'; g.fillRect(cx, 168, 16, 3);  // amarração dourada
        g.fillStyle = '#2a0610'; g.fillRect(cx, WIN_TOP - 22, 16, 3);
      }
    }
    // varão das cortinas
    g.fillStyle = '#7d6430';
    for (const wx of WINDOWS) g.fillRect(wx - 24, WIN_TOP - 24, WIN_W + 48, 2);

    // colunas
    for (const cx of COLUMNS) {
      grd = g.createLinearGradient(cx, 0, cx + 26, 0);
      grd.addColorStop(0, '#16121f'); grd.addColorStop(0.35, '#3f3760'); grd.addColorStop(0.6, '#2c2645'); grd.addColorStop(1, '#100c18');
      g.fillStyle = grd; g.fillRect(cx, 20, 26, 300);
      g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 40; y < 300; y += 3) g.fillRect(cx + 8, y, 1, 1);
      g.fillStyle = '#4a4070'; g.fillRect(cx - 5, 36, 36, 8); g.fillRect(cx - 3, 44, 32, 4);  // capitel
      g.fillStyle = '#c9a24d'; g.fillRect(cx - 5, 36, 36, 1);
      g.fillStyle = '#4a4070'; g.fillRect(cx - 5, 304, 36, 8); g.fillRect(cx - 3, 300, 32, 4); // base
      g.fillStyle = '#1a1528'; g.fillRect(cx - 5, 311, 36, 1);
    }

    // estandartes vermelhos
    for (const bx of [975]) {
      g.fillStyle = '#5c0e1c'; g.fillRect(bx, 50, 30, 120);
      g.beginPath(); g.moveTo(bx, 170); g.lineTo(bx + 15, 186); g.lineTo(bx + 30, 170); g.fill();
      g.fillStyle = '#7f1526'; g.fillRect(bx + 2, 50, 3, 128);
      g.fillStyle = '#c9a24d'; g.fillRect(bx - 3, 48, 36, 3);
      g.fillRect(bx + 2, 52, 26, 1); g.fillRect(bx + 2, 160, 26, 1);
      // emblema: morcego dourado
      g.fillRect(bx + 13, 96, 4, 8);
      g.fillRect(bx + 7, 96, 6, 2); g.fillRect(bx + 17, 96, 6, 2);
      g.fillRect(bx + 5, 98, 4, 3); g.fillRect(bx + 21, 98, 4, 3);
      g.fillRect(bx + 9, 99, 3, 2); g.fillRect(bx + 18, 99, 3, 2);
    }

    // blocos sólidos
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      const v = tileAt(tx, ty), x = tx * T, y = ty * T;
      if (v === 1) {
        const floor = ty >= 16 && tx > 1 && tx < COLS - 2;
        if (floor) {
          g.fillStyle = ty === 16 ? '#3a3254' : '#231d35'; g.fillRect(x, y, T, T);
          if (ty === 16) {
            g.fillStyle = '#7a6fa0'; g.fillRect(x, y, T, 1);
            g.fillStyle = '#524776'; g.fillRect(x, y + 1, T, 1);
            if (tx % 2 === 0) { g.fillStyle = '#16121f'; g.fillRect(x, y, 1, T); }
            g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + 12, T, 8);
          } else {
            g.fillStyle = '#15111f'; if (tx % 2) g.fillRect(x, y, 1, T); g.fillRect(x, y, T, 1);
          }
        } else {
          g.fillStyle = '#2f2848'; g.fillRect(x, y, T, T);
          g.fillStyle = '#463d68'; g.fillRect(x, y, T, 1); g.fillRect(x, y, 1, T);
          g.fillStyle = '#17131f'; g.fillRect(x, y + T - 1, T, 1); g.fillRect(x + T - 1, y, 1, T);
          g.fillStyle = '#211c33'; g.fillRect(x + 1, y + 9, T - 2, 1); g.fillRect(x + (ty % 2 ? 6 : 13), y + 1, 1, 8); g.fillRect(x + (ty % 2 ? 13 : 6), y + 10, 1, 9);
        }
      } else if (v === 3) {
        g.fillStyle = '#4a4070'; g.fillRect(x, y, T, 6);
        g.fillStyle = '#8c80b8'; g.fillRect(x, y, T, 1);
        g.fillStyle = '#c9a24d'; g.fillRect(x, y + 5, T, 1);
        g.fillStyle = '#1b1628'; g.fillRect(x, y + 6, T, 1);
        if (tx % 2 === 0) { // mísula
          g.fillStyle = '#3a3258';
          for (let i = 0; i < 8; i++) g.fillRect(x + 6 + Math.floor(i / 2), y + 7 + i, 8 - i, 1);
        }
      }
    }
    // placas de pedra com dicas
    plaque(g, 46, 128, 'PULO DUPLO');
    plaque(g, 530, 124, 'SUPER SALTO');
    plaque(g, 676, 88, 'SÓ O MORCEGO');
    plaque(g, 850, 232, 'SÓ O LOBO');
    plaque(g, 950, 236, 'SÓ A NÉVOA');
    // pedestal da relíquia
    g.fillStyle = '#3d3559'; g.fillRect(1166, 290, 28, 30); g.fillStyle = '#6c6094'; g.fillRect(1162, 286, 36, 5);
    g.fillStyle = '#c9a24d'; g.fillRect(1162, 286, 36, 1);
  }

  function plaque(g, x, y, text) {
    g.font = `8px ${PIXEL_FONT}`;
    const w = Math.ceil(g.measureText(text).width) + 12;
    g.fillStyle = '#15111f'; g.fillRect(x - 1, y - 1, w + 2, 15);
    g.fillStyle = '#3f3660'; g.fillRect(x, y, w, 13);
    g.fillStyle = '#6c6094'; g.fillRect(x, y, w, 1);
    g.fillStyle = '#c9a24d'; g.textBaseline = 'middle'; g.fillText(text, x + 6, y + 7);
  }

  function renderFront() { // grade de ferro (fica na frente do jogador)
    const g = front.getContext('2d');
    g.clearRect(0, 0, ROOM_W, ROOM_H);
    const x0 = 52 * T, y0 = T, y1 = 16 * T;
    for (let x = x0 + 1; x < x0 + T; x += 5) {
      g.fillStyle = '#1c1b26'; g.fillRect(x, y0, 3, y1 - y0);
      g.fillStyle = '#5a5870'; g.fillRect(x, y0, 1, y1 - y0);
    }
    for (let y = y0 + 30; y < y1; y += 60) { g.fillStyle = '#24222f'; g.fillRect(x0 - 2, y, T + 4, 4); g.fillStyle = '#6b6984'; g.fillRect(x0 - 2, y, T + 4, 1); }
    g.fillStyle = '#24222f'; g.fillRect(x0 - 2, y1 - 6, T + 4, 6);
  }

  // ---------------------------------------------------------------- estado do jogo
  let player, enemies, candles, items, projs, particles, texts, afterimages;
  let camX = 0, shake = 0, hitstop = 0, time = 0, paused = false;
  let toast = null, banner = 2.5, relicTaken = false, message = null;

  const FORMS = {
    human: { w: 22, h: 68 },
    crouch: { w: 22, h: 42 },
    wolf: { w: 50, h: 44 },
    bat: { w: 24, h: 22 },
    mist: { w: 30, h: 30 },
  };

  function newPlayer(d = {}) {
    return {
      x: d.x ?? 90, y: d.y ?? 320, vx: 0, vy: 0, face: d.face ?? 1,
      w: 22, h: 68, form: 'human', onGround: true, jumps: 0,
      act: null, actT: 0, animT: 0, landT: 0, flipT: 0, dropT: 0,
      hp: d.hp ?? 100, maxHp: 100, mp: d.mp ?? 100, maxMp: 100, hearts: d.hearts ?? 50,
      inv: 0, hurtT: 0, buff: 0, morph: null, swordOut: false, crouching: false,
      blockFlash: 0, trailT: 0,
    };
  }

  function resetRoom(d) {
    buildMap();
    player = newPlayer(d);
    enemies = [
      dummy(640),
      skull(520, 150, 0), skull(700, 120, 2.1),
      skeleton(330), skeleton(770),
    ];
    candles = [[120, 214], [470, 214], [570, 76], [716, 44], [896, 270], [1010, 214], [1240, 214]]
      .map(([x, y]) => ({ x, y, alive: true, t: 0 }));
    items = []; projs = []; particles = []; texts = []; afterimages = [];
    camX = clamp(player.x - W / 2, 0, ROOM_W - W);
    relicTaken = d?.relic ?? false;
  }

  // ---------------------------------------------------------------- inimigos
  function dummy(x) {
    return {
      kind: 'dummy', x, y: 320, w: 30, h: 62, hp: Infinity, wob: 0, wobV: 0, combo: 0, comboT: 0, total: 0,
      box() { return { x: this.x - 15, y: this.y - 62, w: 30, h: 62 }; },
      hurt(dmg, dir) { this.wobV += dir * 6; this.combo++; this.comboT = 1.6; this.total += dmg; },
      update(dt) {
        this.wobV += -this.wob * 60 * dt; this.wobV *= Math.pow(0.04, dt); this.wob += this.wobV * dt;
        if ((this.comboT -= dt) <= 0) { this.combo = 0; this.total = 0; }
      },
      draw(g) {
        const x = Math.round(this.x - camX), y = this.y;
        g.save(); g.translate(x, y); g.rotate(this.wob * 0.08);
        g.fillStyle = '#3a2416'; g.fillRect(-3, -62, 6, 62);         // poste
        g.fillStyle = '#5a3a22'; g.fillRect(-2, -62, 2, 62);
        g.fillStyle = '#4a2f1c'; g.fillRect(-20, -44, 40, 4);         // braços
        g.fillStyle = '#a7834a'; g.fillRect(-12, -50, 24, 28);        // saco de palha
        g.fillStyle = '#c9a466'; g.fillRect(-12, -50, 3, 28);
        g.fillStyle = '#6e5228'; g.fillRect(-12, -42, 24, 2); g.fillRect(-12, -30, 24, 2);
        g.fillStyle = '#d8bb7a'; for (let i = 0; i < 6; i++) g.fillRect(-14 + i * 5, -24 + (i % 2), 2, 4);
        g.fillStyle = '#b8955a'; g.fillRect(-8, -64, 16, 14);         // cabeça
        g.fillStyle = '#3b2a16'; g.fillRect(-5, -60, 3, 1); g.fillRect(-4, -61, 1, 3); g.fillRect(2, -60, 3, 1); g.fillRect(3, -61, 1, 3);
        g.fillStyle = '#6c6f7d'; g.fillRect(-9, -70, 18, 7);           // elmo amassado
        g.fillStyle = '#9da1b3'; g.fillRect(-9, -70, 18, 1);
        g.fillStyle = '#4a4c58'; g.fillRect(-10, -64, 20, 2);
        g.restore();
        if (this.combo > 0) {
          const a = clamp(this.comboT, 0, 1);
          g.globalAlpha = a;
          textOut(g, `${this.combo} GOLPES`, x, y - 92, '#f2d27a', 8);
          textOut(g, `${this.total} DANO`, x, y - 82, '#e9e1cf', 8);
          g.globalAlpha = 1;
        }
      },
    };
  }

  /** Criatura possuída que os outros inimigos devem atacar (nunca a própria). */
  function possessedFoe(self) {
    const c = player && player.possess;
    return c && c !== self && c.alive ? c : null;
  }
  function drawStun(g, x, y) {
    g.fillStyle = '#ffe08a';
    for (let i = 0; i < 3; i++) { const a = time * 6 + i * 2.09; g.fillRect(Math.round(x + Math.cos(a) * 9), Math.round(y + Math.sin(a) * 3), 2, 2); }
  }

  function skull(hx, hy, phase) {
    return {
      kind: 'skull', name: 'CAVEIRA', hx, hy, x: hx, y: hy, phase, hp: 30, maxHp: 30, alive: true, respawn: 0, flash: 0, kx: 0,
      face: 1, stun: 0, possessed: false, cd: 0, dashT: 0, hitSet: null,
      box() { return { x: this.x - 11, y: this.y - 11, w: 22, h: 22 }; },
      hurt(dmg, dir) {
        this.hp -= dmg; this.flash = 0.12; if (!this.possessed) this.kx = dir * 60;
        if (this.hp <= 0) {
          this.alive = false; this.respawn = 5;
          burst(this.x, this.y, 26, ['#e9e1cf', '#6fb6ff', '#ffffff'], 140);
          if (Math.random() < 0.6) dropItem(this.x, this.y);
          audio.play('break');
        }
      },
      update(dt) {
        if (!this.alive) {
          if ((this.respawn -= dt) <= 0) { Object.assign(this, { alive: true, hp: this.maxHp, x: this.hx, y: this.hy, stun: 0, kx: 0 }); burst(this.x, this.y, 12, ['#6fb6ff'], 60); }
          return;
        }
        this.phase += dt; this.flash -= dt;
        const flameColor = this.possessed ? ['#c0283c', '#ff6070'] : ['#3d8bff', '#9ed0ff'];
        if (Math.random() < 0.5) particles.push({ x: this.x + (Math.random() - 0.5) * 10, y: this.y + 8, vx: 0, vy: -20 - Math.random() * 30, life: 0.5, max: 0.5, color: flameColor[Math.random() < 0.5 ? 0 : 1], size: 2, add: true });
        if (this.possessed) { this.control(dt); return; }
        if (this.stun > 0) { this.stun -= dt; this.kx *= Math.pow(0.02, dt); this.x += this.kx * dt; return; }
        const foe = possessedFoe(this);
        let tx, ty;
        if (foe && Math.abs(foe.x - this.hx) < 300) { // ataca a criatura possuída
          const b = foe.box();
          tx = b.x + b.w / 2; ty = b.y + b.h / 2;
        } else {
          const near = Math.abs(player.x - this.hx) < 220 && player.form !== 'mist';
          tx = near ? lerp(this.hx, player.x, 0.35) : this.hx + Math.sin(this.phase * 0.7) * 50;
          ty = this.hy + Math.sin(this.phase * 2.2) * 18;
        }
        this.x += (tx - this.x) * dt * 1.2 + this.kx * dt;
        this.y += (ty - this.y) * dt * 2;
        this.kx *= Math.pow(0.02, dt);
      },
      /** Controlada pelo jogador: voa, X dispara chama, C investida em chamas. */
      control(dt) {
        this.cd -= dt;
        const e = { x: this.x, y: this.y + 11, w: 22, h: 22, vx: 0, vy: 0, dropT: 1, form: 'bat' };
        if (this.dashT > 0) {
          this.dashT -= dt;
          moveX(e, this.face * 340 * dt);
        } else {
          const ax = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
          const ay = (down('down') ? 1 : 0) - ((down('up') || down('jump')) ? 1 : 0);
          const n = Math.hypot(ax, ay) || 1;
          moveX(e, ax / n * 150 * dt); moveY(e, ay / n * 150 * dt);
          if (ax) this.face = ax;
          if (pressed.has('attack') && this.cd <= 0) {
            this.cd = 0.3; audio.play('fire');
            projs.push({ kind: 'bfire', x: this.x + this.face * 12, y: this.y, vx: this.face * 300, t: 0, hitSet: new Set() });
          } else if (pressed.has('tk') && this.cd <= 0) {
            this.cd = 0.8; this.dashT = 0.35; this.hitSet = new Set(); showToast('INVESTIDA EM CHAMAS'); audio.play('swish');
          }
        }
        this.x = e.x; this.y = e.y - 11;
        if (this.dashT > 0) {
          strike(this.box(), 16, this.face, this.hitSet, '#ff6070', { exclude: this, raw: true });
          particles.push({ x: this.x - this.face * 10, y: this.y + (Math.random() - 0.5) * 12, vx: -this.face * 40, vy: 0, life: 0.3, max: 0.3, color: '#ff4060', size: 3, add: true });
        }
      },
      draw(g) {
        if (!this.alive) return;
        const x = Math.round(this.x - camX - 12), y = Math.round(this.y - 12 + Math.sin(this.phase * 6) * 1);
        glow(g, this.x - camX, this.y, 26, this.possessed ? 'rgba(230,30,60,.4)' : 'rgba(60,140,255,.25)');
        const img = this.possessed ? SKULL_P : SKULL;
        if (this.flash > 0) { g.globalAlpha = 0.6; }
        g.drawImage(img, x, y);
        if (this.flash > 0) { g.globalCompositeOperation = 'lighter'; g.drawImage(img, x, y); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
        if (this.stun > 0) drawStun(g, this.x - camX, this.y - 16);
      },
    };
  }

  function skeleton(hx) {
    return {
      kind: 'skel', name: 'ESQUELETO', hx, x: hx, y: 320, w: 24, h: 66, vx: 0, vy: 0, face: -1, onGround: true, dropT: 0, form: 'skel',
      hp: 40, maxHp: 40, alive: true, respawn: 0, flash: 0, stun: 0, possessed: false, cd: 1.2, walkT: 0, slashT: 0, hitSet: null,
      box() { return { x: this.x - 12, y: this.y - 66, w: 24, h: 66 }; },
      hurt(dmg, dir) {
        this.hp -= dmg; this.flash = 0.12;
        if (!this.possessed) this.vx = dir * 140;
        if (this.hp <= 0) {
          this.alive = false; this.respawn = 6;
          burst(this.x, this.y - 34, 30, ['#e9e1cf', '#9a917f', '#ffffff'], 160, { grav: 500 });
          if (Math.random() < 0.6) dropItem(this.x, this.y - 30);
          audio.play('break');
        }
      },
      physics(dt) {
        this.vy = Math.min(MAX_FALL, this.vy + GRAV * dt);
        moveX(this, this.vx * dt);
        this.onGround = moveY(this, this.vy * dt) === 'floor';
      },
      update(dt) {
        if (!this.alive) {
          if ((this.respawn -= dt) <= 0) { Object.assign(this, { alive: true, hp: this.maxHp, x: this.hx, y: 320, vx: 0, vy: 0, stun: 0 }); burst(this.x, this.y - 24, 14, ['#9a917f'], 60); }
          return;
        }
        this.flash -= dt; this.cd -= dt; this.slashT -= dt;
        if (this.possessed) { this.control(dt); return; }
        if (this.stun > 0) { this.stun -= dt; this.vx *= Math.pow(0.02, dt); this.physics(dt); return; }
        const foe = possessedFoe(this);
        const tgt = foe || (player.form !== 'mist' ? player : null);
        let want;
        if (tgt && Math.abs(tgt.x - this.x) < 240 && Math.abs(tgt.y - this.y) < 120) {
          const dx = tgt.x - this.x;
          this.face = Math.sign(dx) || this.face;
          want = Math.abs(dx) > 130 ? this.face * 45 : Math.abs(dx) < 70 ? -this.face * 35 : 0;
          if (this.cd <= 0) { this.cd = 1.6 + Math.random() * 0.6; throwBone(this, 'enemy', dx); }
        } else { // patrulha perto de casa
          if (Math.abs(this.x - this.hx) > 70) this.face = Math.sign(this.hx - this.x);
          want = this.face * 30;
        }
        this.vx = lerp(this.vx, want, Math.min(1, dt * 6));
        this.walkT += Math.abs(this.vx) * dt;
        this.physics(dt);
      },
      /** Controlado pelo jogador: anda e pula, X arremessa osso, C golpe com espada de osso. */
      control(dt) {
        const ax = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
        this.vx = ax * 115;
        if (ax) this.face = ax;
        if (pressed.has('jump') && this.onGround) { this.vy = -470; audio.play('jump'); }
        if (pressed.has('attack') && this.cd <= 0) { this.cd = 0.35; throwBone(this, 'possessed', this.face * 160); }
        else if (pressed.has('tk') && this.cd <= 0) { this.cd = 0.45; this.slashT = 0.22; this.hitSet = new Set(); audio.play('swish'); }
        if (this.slashT > 0) strike({ x: this.face > 0 ? this.x + 4 : this.x - 48, y: this.y - 64, w: 44, h: 48 }, 14, this.face, this.hitSet, '#e9e1cf', { exclude: this, raw: true });
        this.walkT += Math.abs(this.vx) * dt;
        this.physics(dt);
      },
      draw(g) {
        if (!this.alive) return;
        const set = this.possessed ? SKEL_P : SKEL;
        const img = set[Math.abs(this.vx) > 5 ? Math.floor(this.walkT / 14) % 2 : 0];
        const x = Math.round(this.x - camX), y = Math.round(this.y);
        if (this.possessed) glow(g, x, y - 36, 46, 'rgba(220,30,60,.38)');
        g.save(); g.translate(x, y); if (this.face < 0) g.scale(-1, 1);
        if (this.flash > 0) g.globalAlpha = 0.6;
        g.drawImage(img, -21, -72);
        if (this.slashT > 0) { // golpe em arco com a espada de osso
          const k = 1 - this.slashT / 0.22;
          g.strokeStyle = `rgba(240,230,210,${0.9 - k * 0.6})`; g.lineWidth = 3;
          g.beginPath(); g.arc(8, -40, 34, -1.3 + k * 0.4, -1.3 + k * 2.2); g.stroke();
          g.fillStyle = '#e9e1cf'; g.save(); g.translate(12, -40); g.rotate(-1.3 + k * 2.2); g.fillRect(0, -1, 28, 3); g.restore();
        }
        g.restore();
        g.globalAlpha = 1;
        if (this.stun > 0) drawStun(g, x, y - 78);
      },
    };
  }

  function throwBone(e, owner, dx) {
    let vx = clamp(dx * 1.3, -260, 260);
    if (Math.abs(vx) < 90) vx = (Math.sign(vx) || e.face) * 90;
    projs.push({ kind: 'bone', owner, x: e.x + e.face * 10, y: e.y - 58, vx, vy: -330, t: 0, rot: 0, hitSet: new Set() });
    audio.play('swish');
  }

  function dropItem(x, y) {
    const r = Math.random();
    const kind = r < 0.5 ? 'heart' : r < 0.8 ? 'orb' : 'potion';
    items.push({ kind, x, y, vy: -120, t: 0 });
  }

  // ---------------------------------------------------------------- efeitos
  function burst(x, y, n, colors, speed, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + (opts.up || 0), life: opts.life || 0.5, max: opts.life || 0.5, color: colors[i % colors.length], size: opts.size || 2, grav: opts.grav ?? 200, add: true });
    }
  }
  function dmgText(x, y, n, color = '#ffffff') { texts.push({ x, y, vy: -60, t: 0, s: String(n), color }); }
  function showToast(name) { toast = { name, t: 1.6 }; }
  function glow(g, x, y, r, color) {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
  }
  function textOut(g, s, x, y, color, size = 8, align = 'center') {
    g.font = `${size}px ${PIXEL_FONT}`; g.textAlign = align; g.textBaseline = 'middle';
    g.fillStyle = '#000';
    g.fillText(s, x - 1, y); g.fillText(s, x + 1, y); g.fillText(s, x, y - 1); g.fillText(s, x, y + 1);
    g.fillStyle = color; g.fillText(s, x, y);
  }

  // ---------------------------------------------------------------- física
  function boxOf(e) { return { x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h }; }
  function fits(e, w, h, x = e.x, y = e.y, form = e.form) {
    const probe = { form };
    const tx0 = Math.floor((x - w / 2) / T), tx1 = Math.floor((x + w / 2 - 0.01) / T);
    const ty0 = Math.floor((y - h) / T), ty1 = Math.floor((y - 0.01) / T);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (solidFor(probe, tx, ty)) return false;
    return true;
  }
  function moveX(e, dx) {
    e.x += dx;
    const ty0 = Math.floor((e.y - e.h) / T), ty1 = Math.floor((e.y - 0.01) / T);
    if (dx > 0) {
      const tx = Math.floor((e.x + e.w / 2 - 0.01) / T);
      for (let ty = ty0; ty <= ty1; ty++) if (solidFor(e, tx, ty)) { e.x = tx * T - e.w / 2; e.vx = 0; return true; }
    } else if (dx < 0) {
      const tx = Math.floor((e.x - e.w / 2) / T);
      for (let ty = ty0; ty <= ty1; ty++) if (solidFor(e, tx, ty)) { e.x = (tx + 1) * T + e.w / 2; e.vx = 0; return true; }
    }
    return false;
  }
  function moveY(e, dy) {
    const prevB = e.y;
    e.y += dy;
    const tx0 = Math.floor((e.x - e.w / 2) / T), tx1 = Math.floor((e.x + e.w / 2 - 0.01) / T);
    if (dy > 0) {
      const ty = Math.floor((e.y - 0.01) / T);
      for (let tx = tx0; tx <= tx1; tx++) {
        const v = tileAt(tx, ty);
        const oneWay = v === 3 && prevB <= ty * T + 0.5 && e.dropT <= 0 && e.form !== 'bat' && e.form !== 'mist';
        if (solidFor(e, tx, ty) || oneWay) { e.y = ty * T; e.vy = 0; return 'floor'; }
      }
    } else if (dy < 0) {
      const ty = Math.floor((e.y - e.h) / T);
      for (let tx = tx0; tx <= tx1; tx++) if (solidFor(e, tx, ty)) { e.y = (ty + 1) * T + e.h; e.vy = 0; return 'ceil'; }
    }
    return null;
  }

  // ---------------------------------------------------------------- ataques
  const mult = () => player.buff > 0 ? 2 : 1;
  /** Aplica dano a tudo que encostar na caixa. `hitSet` evita acertar o mesmo alvo duas vezes. */
  function strike(box, base, dir, hitSet, color, opts = {}) {
    let any = false;
    for (const en of enemies) {
      if (en === opts.exclude || en.alive === false || hitSet.has(en) || !overlap(box, en.box())) continue;
      hitSet.add(en);
      const dmg = Math.round(base * (opts.raw ? 1 : mult()) * (0.85 + Math.random() * 0.3));
      en.hurt(dmg, dir);
      const b = en.box();
      dmgText(b.x + b.w / 2, b.y - 4, dmg, player.buff > 0 ? '#ffb347' : '#ffffff');
      burst(b.x + b.w / 2, b.y + b.h / 2, 10, [color || '#ff4060', '#ffd0d8', '#ffffff'], 160, { life: 0.35 });
      any = true;
    }
    for (const c of candles) {
      if (!c.alive || hitSet.has(c)) continue;
      if (overlap(box, { x: c.x - 6, y: c.y - 16, w: 12, h: 22 })) {
        hitSet.add(c); c.alive = false; c.t = 12;
        burst(c.x, c.y - 8, 16, ['#ffcf5a', '#ff7a2a', '#ffffff'], 120);
        dropItem(c.x, c.y - 8);
        audio.play('break');
      }
    }
    if (any) { hitstop = 0.05; shake = Math.max(shake, 2); audio.play('hit'); }
    return any;
  }

  // ---------------------------------------------------------------- jogador
  function setForm(form) {
    const p = player;
    const s = FORMS[form];
    p.form = form; p.w = s.w; p.h = s.h;
    if (!fits(p, p.w, p.h)) { // forma mais larga encostada na parede: empurra para fora
      for (let d = 2; d <= 40; d += 2) {
        if (fits(p, p.w, p.h, p.x + d)) { p.x += d; break; }
        if (fits(p, p.w, p.h, p.x - d)) { p.x -= d; break; }
      }
    }
  }

  /** Inicia a transformação. Para voltar à forma humana, toca a animação ao contrário. */
  function startMorph(target) {
    const p = player;
    if (p.morph) return;
    if (p.form === target) target = 'human';
    if (target === 'human') {
      // precisa de espaço para ficar de pé
      let y = p.y;
      if (p.form === 'bat' || p.form === 'mist') { // tenta descer até achar espaço
        if (!fits(p, FORMS.human.w, FORMS.human.h, p.x, y, 'human')) {
          const room = [0, 10, 20, 30, 40, 50].find(dy => fits(p, FORMS.human.w, FORMS.human.h, p.x, y + dy, 'human'));
          if (room === undefined) { flashMessage('Sem espaço para voltar'); audio.play('deny'); return; }
          y += room;
        }
      } else if (!fits(p, FORMS.human.w, FORMS.human.h, p.x, y, 'human')) { flashMessage('Sem espaço para voltar'); audio.play('deny'); return; }
      const anim = { mist: 'to_mist', bat: 'to_bat', wolf: 'to_wolf' }[p.form];
      p.y = y;
      p.morph = { anim, dir: -1, t: 0, target: 'human', y };
      audio.play('unmorph');
    } else {
      if (p.form !== 'human') { // troca direta entre formas: passa pela humana
        startMorph('human');
        if (p.morph) p.morph.then = target;
        return;
      }
      const cost = 5;
      if (p.mp < cost) { flashMessage('MP insuficiente'); audio.play('deny'); return; }
      p.mp -= cost;
      p.morph = { anim: { mist: 'to_mist', bat: 'to_bat', wolf: 'to_wolf' }[target], dir: 1, t: 0, target };
      p.act = null;
      showToast({ mist: 'NÉVOA', bat: 'MORCEGO', wolf: 'LOBO' }[target]);
      audio.play('morph');
    }
    p.vx = 0; p.vy = 0;
  }

  function flashMessage(s) { message = { s, t: 1.4 }; }

  // ---------------------------------------------------------------- possessão (forma de névoa)
  function tryPossess() {
    const p = player, pb = boxOf(p);
    const reach = { x: pb.x - 8, y: pb.y - 8, w: pb.w + 16, h: pb.h + 16 };
    const c = enemies.find(en => en.alive && en.control && !en.possessed && overlap(reach, en.box()));
    if (!c) { flashMessage('Encoste a névoa num inimigo'); audio.play('deny'); return; }
    if (p.mp < 10) { flashMessage('MP insuficiente'); audio.play('deny'); return; }
    p.mp -= 10; p.possess = c;
    Object.assign(c, { possessed: true, stun: 0, vx: 0, kx: 0, cd: 0.25, hitSet: new Set() });
    showToast(`POSSESSÃO: ${c.name}`); audio.play('morph');
    const b = c.box();
    burst(b.x + b.w / 2, b.y + b.h / 2, 30, ['#c0283c', '#ff4060', '#2a0610'], 140, { life: 0.5, grav: 0 });
  }

  function releasePossession(msg) {
    const p = player, c = p.possess;
    if (!c) return;
    p.possess = null; c.possessed = false;
    if (c.alive) { c.stun = 2.5; c.vx = 0; c.dashT = 0; c.slashT = 0; }
    const b = c.box();
    p.x = b.x + b.w / 2; p.y = Math.min(b.y + b.h, b.y + b.h / 2 + p.h / 2);
    p.vx = p.vy = 0; p.inv = 0.8;
    burst(p.x, p.y - p.h / 2, 24, ['#c0283c', '#ff4060'], 110, { life: 0.5, grav: 0 });
    audio.play('unmorph');
    if (msg) flashMessage(msg);
  }

  function damageCreature(c, dmg, dir) {
    c.hurt(dmg, dir);
    const b = c.box();
    dmgText(b.x + b.w / 2, b.y - 4, dmg, '#ff6070');
    audio.play('hurt'); shake = Math.max(shake, 2);
  }

  function updatePossession(dt) {
    const p = player, c = p.possess;
    if (!c.alive) { releasePossession('A criatura foi destruída'); return; }
    if (pressed.has('mist') || pressed.has('bat') || pressed.has('wolf')) { releasePossession(); return; }
    const b = c.box();
    p.x = b.x + b.w / 2; p.y = b.y + b.h; p.vx = p.vy = 0;
    if (Math.random() < 0.5) particles.push({ x: b.x + Math.random() * b.w, y: b.y + Math.random() * b.h, vx: (Math.random() - 0.5) * 16, vy: -25, life: 0.6, max: 0.6, color: Math.random() < 0.5 ? '#c0283c' : '#ff4060', size: 2, add: true });
    // os outros inimigos atacam a criatura possuída
    for (const en of enemies) {
      if (en === c || en.alive === false || !en.control || en.stun > 0) continue;
      en.biteCd = (en.biteCd || 0) - dt;
      if (en.biteCd <= 0 && overlap(b, en.box())) { en.biteCd = 0.8; damageCreature(c, 8, Math.sign(b.x + b.w / 2 - en.x) || 1); }
    }
  }

  function updatePlayer(dt) {
    const p = player;
    p.animT += dt;
    p.inv = Math.max(0, p.inv - dt);
    p.dropT -= dt; p.landT -= dt; p.flipT -= dt; p.blockFlash -= dt;
    if (p.buff > 0) {
      p.buff -= dt;
      if (Math.random() < 0.6) particles.push({ x: p.x + (Math.random() - 0.5) * 24, y: p.y - Math.random() * p.h, vx: 0, vy: -40 - Math.random() * 40, life: 0.5, max: 0.5, color: Math.random() < 0.5 ? '#ff5a1f' : '#ffc04a', size: 2, add: true });
    }
    p.mp = Math.min(p.maxMp, p.mp + (p.possess ? -9 : p.form === 'mist' ? -6 : 4) * dt);
    if (p.form === 'mist' && p.mp <= 0) {
      p.mp = 0;
      if (p.possess) releasePossession('MP esgotado');
      else if ((p.retryT = (p.retryT || 0) - dt) <= 0) { p.retryT = 0.6; startMorph('human'); }
    }

    // ----- transformação em andamento
    if (p.morph) {
      const m = p.morph, n = ATLAS[m.anim].length, dur = n * 0.07;
      m.t += dt;
      if (m.t >= dur) {
        if (m.dir > 0) {
          setForm(m.target);
          if (m.target === 'bat' || m.target === 'mist') p.y -= 10;
        } else {
          setForm('human'); p.y = m.y ?? p.y;
        }
        const then = m.then;
        p.morph = null; p.vy = 0;
        if (then) startMorph(then);
      }
      return;
    }

    if (p.possess) { updatePossession(dt); return; }

    // ----- comandos de forma
    for (const f of ['mist', 'bat', 'wolf']) if (pressed.has(f)) { startMorph(f); return; }

    if (p.form === 'human') updateHuman(dt);
    else if (p.form === 'wolf') updateWolf(dt);
    else updateFlyer(dt);

    // dano por contato
    if (p.inv <= 0 && p.form !== 'mist') {
      const pb = boxOf(p);
      for (const en of enemies) {
        if (!en.control || !en.alive || en.possessed || en.stun > 0 || !overlap(pb, en.box())) continue;
        const from = Math.sign(p.x - en.x) || 1;
        const blocking = p.act === 'block' && from === -p.face;
        if (blocking) {
          p.blockFlash = 0.18; en.hurt(4, -from); en.kx = -from * 220;
          burst(p.x + p.face * 14, p.y - 44, 14, ['#ffe08a', '#ffffff'], 160, { life: 0.3 });
          audio.play('block'); p.inv = 0.3;
        } else if (p.act === 'cape') {
          p.blockFlash = 0.18; en.kx = -from * 220; audio.play('block'); p.inv = 0.3;
        } else {
          hurtPlayer(10, from);
          break;
        }
      }
    }
    // relíquia
    if (!relicTaken && Math.abs(p.x - 1180) < 20 && p.y > 240) {
      relicTaken = true; flashMessage('Obteve a Relíquia do Eco'); audio.play('pickup'); burst(1180, 270, 30, ['#ffe08a', '#9ed0ff', '#ffffff'], 120);
    }
  }

  function hurtPlayer(dmg, from) {
    const p = player;
    p.hp -= dmg; p.inv = 1.0; shake = 4;
    dmgText(p.x, p.y - p.h - 6, dmg, '#ff6070');
    audio.play('hurt');
    if (p.form === 'human') { p.act = 'hurt'; p.actT = 0; p.vx = from * 160; p.vy = -260; p.onGround = false; }
    if (p.hp <= 0) {
      burst(p.x, p.y - 30, 40, ['#a3172b', '#ff4060', '#000000'], 200);
      flashMessage('Você caiu. A sala foi reiniciada.');
      const hearts = p.hearts;
      resetRoom({ hearts });
    }
  }

  function physics(p, dt, gravity = true) {
    if (gravity) p.vy = Math.min(MAX_FALL, p.vy + GRAV * dt);
    moveX(p, p.vx * dt);
    const wasGround = p.onGround;
    p.onGround = false;
    const hit = moveY(p, p.vy * dt);
    if (hit === 'floor') { p.onGround = true; p.jumps = 0; if (!wasGround) onLand(p); }
  }

  function onLand(p) {
    if (p.form === 'human') {
      if (p.act === 'sjump') { p.act = null; }
      p.landT = 0.12;
      burst(p.x, p.y, 6, ['#8c80b8', '#5a5078'], 50, { life: 0.3, grav: 0, up: -10 });
    }
  }

  function updateHuman(dt) {
    const p = player;
    const L = down('left'), R = down('right'), D = down('down'), U = down('up');
    const axis = (R ? 1 : 0) - (L ? 1 : 0);
    let busy = p.act && !['throw'].includes(p.act);

    // ações em andamento
    if (p.act) {
      p.actT += dt;
      switch (p.act) {
        case 'throw': {
          if (p.actT >= 0.1 && !p.thrown) { p.thrown = true; spawnSword(); }
          if (p.actT > 0.32) p.act = null;
          break;
        }
        case 'tk': {
          const fi = Math.floor(p.actT / 0.075);
          if (p.onGround) p.vx = 0;
          else p.vy = Math.min(p.vy, 90); // no ar: flutua de leve durante o golpe
          if (fi >= 3 && fi <= 4) {
            const box = { x: p.face > 0 ? p.x + 10 : p.x - 140, y: p.y - 80, w: 130, h: 72 };
            strike(box, 28, p.face, p.hitSet, '#ffb0a0');
          }
          if (fi === 3 && !p.tkShake) { p.tkShake = true; shake = 3; burst(p.x + p.face * 80, p.y - 44, 18, ['#ffd0b0', '#ff6a50', '#ffffff'], 180, { life: 0.35 }); }
          if (fi >= 6) p.act = null;
          break;
        }
        case 'block': case 'cape': {
          p.vx = 0;
          if (!down('block')) p.act = null;
          break;
        }
        case 'aura': {
          p.vx = 0;
          const lvl = Math.min(5, Math.floor(p.actT / 0.16));
          if (lvl >= 1 && Math.random() < 0.5) particles.push({ x: p.x + (Math.random() - 0.5) * 40, y: p.y - 4, vx: (Math.random() - 0.5) * 20, vy: -60 - Math.random() * 60, life: 0.6, max: 0.6, color: Math.random() < 0.5 ? '#ff6a1f' : '#ffd36a', size: 2, add: true });
          if (lvl >= 5 && !p.auraDone) {
            if (p.mp >= 20) {
              p.auraDone = true; p.mp -= 20; p.buff = 10; shake = 4;
              showToast('AURA DE FOGO'); audio.play('aura');
              burst(p.x, p.y - 40, 40, ['#ff5a1f', '#ffd36a', '#ffffff'], 220, { life: 0.6 });
            } else if (!p.auraFail) { p.auraFail = true; flashMessage('MP insuficiente'); audio.play('deny'); }
          }
          if (!down('aura')) p.act = null;
          break;
        }
        case 'sjump': {
          if (p.actT < 0.14) { p.vx = 0; }
          else if (!p.launched) {
            p.launched = true; p.vy = -900; p.onGround = false; shake = 5;
            burst(p.x, p.y, 30, ['#ff3a3a', '#ffcf5a', '#ffffff'], 260, { life: 0.5, grav: 300, up: -60 });
            audio.play('burst');
          }
          if (p.launched) {
            p.vx = axis * 150;
            strike(boxOf(p), 10, p.face, p.hitSet, '#ffcf5a');
            if (Math.random() < 0.8) particles.push({ x: p.x + (Math.random() - 0.5) * 10, y: p.y, vx: 0, vy: 40, life: 0.4, max: 0.4, color: Math.random() < 0.5 ? '#ff3a3a' : '#ffcf5a', size: 3, add: true });
            if (p.vy > 0) p.act = null;
          }
          break;
        }
        case 'dash': {
          p.vx = -p.face * 330 * Math.max(0, 1 - p.actT / 0.28);
          if (p.actT > 0.28) p.act = null;
          break;
        }
        case 'hurt': {
          p.vx *= Math.pow(0.1, dt);
          if (p.actT > 0.4 && p.onGround) p.act = null;
          break;
        }
      }
      busy = p.act && p.act !== 'throw';
    }

    // agachar
    p.crouching = false;
    if (!busy && p.onGround && D) {
      p.crouching = true;
    }
    const want = p.crouching ? FORMS.crouch : FORMS.human;
    if (p.h !== want.h) {
      if (want.h > p.h && !fits(p, want.w, want.h)) p.crouching = true;
      else { p.h = want.h; p.w = want.w; }
    }

    // andar
    if (!busy) {
      if (p.crouching) {
        p.vx = 0;
        if (axis) p.face = axis;
      } else {
        const target = axis * 150;
        p.vx = p.onGround ? target : lerp(p.vx, target, Math.min(1, dt * 12));
        if (axis && p.act !== 'throw') p.face = axis;
      }
    }

    // novos comandos
    if (!busy) {
      if (pressed.has('jump')) {
        if (p.onGround && D && standingOnPlatform(p)) { p.dropT = 0.25; p.onGround = false; p.y += 1; }
        else if (p.onGround && U) startSuperJump();
        else if (p.onGround) { p.vy = -520; p.onGround = false; p.jumps = 1; audio.play('jump'); }
        else if (p.jumps < 2) {
          p.vy = -460; p.jumps = 2; p.flipT = 0.32; audio.play('djump');
          burst(p.x, p.y, 10, ['#9b93b3', '#e9e1cf'], 90, { life: 0.3, grav: 0 });
        }
      }
      if (!down('jump') && p.vy < -200 && !p.act) p.vy = -200; // pulo de altura variável
      if (pressed.has('attack') && !p.swordOut) {
        if (p.hearts <= 0) { flashMessage('Sem corações'); audio.play('deny'); }
        else { p.hearts--; p.act = 'throw'; p.actT = 0; p.thrown = false; audio.play('swish'); }
      } else if (pressed.has('tk')) {
        if (p.mp < 12) { flashMessage('MP insuficiente'); audio.play('deny'); }
        else { p.mp -= 12; p.act = 'tk'; p.actT = 0; p.hitSet = new Set(); p.tkShake = false; showToast('TELECINESE'); audio.play('tk'); }
      } else if (pressed.has('block') && p.onGround) {
        p.act = D ? 'cape' : 'block'; p.actT = 0;
      } else if (pressed.has('aura') && p.onGround) {
        p.act = 'aura'; p.actT = 0; p.auraDone = false; p.auraFail = false;
      } else if (pressed.has('sjump') && p.onGround) {
        startSuperJump();
      } else if (pressed.has('dash') && p.onGround) {
        p.act = 'dash'; p.actT = 0; audio.play('swish');
      }
    }

    physics(p, dt, true);
    afterimageTick(dt, p.act === 'dash' || (p.act === 'sjump' && p.launched) || p.buff > 0 && Math.abs(p.vx) > 100);
  }

  function standingOnPlatform(p) {
    const ty = Math.floor(p.y / T);
    const tx0 = Math.floor((p.x - p.w / 2) / T), tx1 = Math.floor((p.x + p.w / 2 - 0.01) / T);
    let plat = false;
    for (let tx = tx0; tx <= tx1; tx++) { const v = tileAt(tx, ty); if (v === 1 || v === 2) return false; if (v === 3) plat = true; }
    return plat;
  }

  function startSuperJump() {
    const p = player;
    if (p.mp < 8) { flashMessage('MP insuficiente'); audio.play('deny'); return; }
    p.mp -= 8; p.act = 'sjump'; p.actT = 0; p.launched = false; p.hitSet = new Set();
    showToast('SUPER SALTO');
  }

  function spawnSword() {
    const p = player;
    p.swordOut = true;
    projs.push({ kind: 'sword', x: p.x + p.face * 24, y: p.y - 50, vx: p.face * 460, dir: p.face, t: 0, back: false, hitSet: new Set() });
  }

  function updateWolf(dt) {
    const p = player;
    const axis = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
    if (p.act) {
      p.actT += dt;
      if (p.act === 'lunge') {
        p.vx = p.face * 360 * Math.max(0.2, 1 - p.actT / 0.35);
        strike({ x: p.face > 0 ? p.x : p.x - 40, y: p.y - 40, w: 40, h: 36 }, 18, p.face, p.hitSet, '#ff4060');
        if (p.actT > 0.35) p.act = null;
      } else if (p.act === 'howl') {
        p.vx = 0;
        if (p.actT > 0.25 && !p.howled) {
          p.howled = true; shake = 3;
          projs.push({ kind: 'ring', x: p.x, y: p.y - 24, r: 10, t: 0, hitSet: new Set() });
        }
        if (p.actT > 0.8) p.act = null;
      }
    } else {
      p.vx = axis * 250;
      if (axis) p.face = axis;
      if (pressed.has('jump') && p.onGround) { p.vy = -480; audio.play('jump'); }
      if (pressed.has('attack')) { p.act = 'lunge'; p.actT = 0; p.hitSet = new Set(); audio.play('swish'); }
      else if (pressed.has('tk') && p.onGround) {
        if (p.mp >= 10) { p.mp -= 10; p.act = 'howl'; p.actT = 0; p.howled = false; showToast('UIVO'); audio.play('howl'); }
        else { flashMessage('MP insuficiente'); audio.play('deny'); }
      }
    }
    if (!down('jump') && p.vy < -200) p.vy = -200;
    physics(p, dt, true);
    if (p.onGround && Math.abs(p.vx) > 100 && Math.random() < 0.35) particles.push({ x: p.x - p.face * 20, y: p.y - 2, vx: -p.face * 30, vy: -20, life: 0.3, max: 0.3, color: '#5a5078', size: 2 });
    afterimageTick(dt, Math.abs(p.vx) > 200);
  }

  function updateFlyer(dt) {
    const p = player;
    const ax = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
    const ay = (down('down') ? 1 : 0) - ((down('up') || down('jump')) ? 1 : 0);
    const speed = p.form === 'bat' ? 175 : 85;
    const n = Math.hypot(ax, ay) || 1;
    p.vx = lerp(p.vx, ax / n * speed, Math.min(1, dt * 8));
    p.vy = lerp(p.vy, ay / n * speed, Math.min(1, dt * 8));
    if (ax) p.face = ax;
    if (p.form === 'mist' && pressed.has('attack')) tryPossess();
    if (p.form === 'bat' && pressed.has('attack')) {
      if (p.mp >= 3) {
        p.mp -= 3; audio.play('fire');
        projs.push({ kind: 'fire', x: p.x + p.face * 12, y: p.y - p.h / 2, vx: p.face * 320, t: 0, hitSet: new Set() });
      } else { flashMessage('MP insuficiente'); audio.play('deny'); }
    }
    moveX(p, p.vx * dt);
    moveY(p, p.vy * dt);
    if (p.form === 'mist' && Math.random() < 0.4) particles.push({ x: p.x + (Math.random() - 0.5) * 30, y: p.y - Math.random() * 30, vx: (Math.random() - 0.5) * 20, vy: -10, life: 0.8, max: 0.8, color: '#c0283c', size: 3, add: true });
  }

  function afterimageTick(dt, on) {
    const p = player;
    p.trailT -= dt;
    if (on && p.trailT <= 0) {
      p.trailT = 0.045;
      const pose = currentPose();
      if (pose) afterimages.push({ ...pose, life: 0.3, color: p.buff > 0 ? '#ff5a1f' : '#5a6dff' });
    }
  }

  // ---------------------------------------------------------------- projéteis, itens, partículas
  function updateProjs(dt) {
    for (const s of projs) {
      s.t += dt;
      if (s.kind === 'sword') {
        if (!s.back && s.t > 0.38) { s.back = true; s.hitSet = new Set(); }
        if (s.back) {
          const tx = player.x, ty = player.y - player.h * 0.6;
          const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy) || 1;
          const sp = 520;
          s.vx = lerp(s.vx, dx / d * sp, Math.min(1, dt * 10));
          s.y += dy / d * sp * dt * 0.9;
          if (d < 18 || s.t > 2.5) { s.dead = true; player.swordOut = false; }
        } else s.vx *= Math.pow(0.35, dt);
        s.x += s.vx * dt;
        s.dir = Math.sign(s.vx) || s.dir;
        strike({ x: s.x - 24, y: s.y - 6, w: 48, h: 12 }, 14, s.dir, s.hitSet, '#ff4060');
        if (Math.random() < 0.8) particles.push({ x: s.x - s.dir * 20, y: s.y + (Math.random() - 0.5) * 4, vx: 0, vy: 0, life: 0.25, max: 0.25, color: '#ff3048', size: 2, add: true });
      } else if (s.kind === 'fire') {
        s.x += s.vx * dt;
        if (Math.random() < 0.9) particles.push({ x: s.x, y: s.y + (Math.random() - 0.5) * 4, vx: -s.vx * 0.1, vy: (Math.random() - 0.5) * 20, life: 0.25, max: 0.25, color: Math.random() < 0.5 ? '#ff7a2a' : '#ffd36a', size: 2, add: true });
        if (strike({ x: s.x - 5, y: s.y - 5, w: 10, h: 10 }, 8, Math.sign(s.vx), s.hitSet, '#ffb347') || solidFor({}, Math.floor(s.x / T), Math.floor(s.y / T)) || s.t > 1.5) {
          s.dead = true; burst(s.x, s.y, 8, ['#ff7a2a', '#ffd36a'], 80, { life: 0.25 });
        }
      } else if (s.kind === 'bfire') { // chama da caveira possuída
        s.x += s.vx * dt;
        if (Math.random() < 0.9) particles.push({ x: s.x, y: s.y + (Math.random() - 0.5) * 4, vx: -s.vx * 0.1, vy: (Math.random() - 0.5) * 20, life: 0.25, max: 0.25, color: Math.random() < 0.5 ? '#ff4060' : '#ffb0c0', size: 2, add: true });
        if (strike({ x: s.x - 5, y: s.y - 5, w: 10, h: 10 }, 10, Math.sign(s.vx), s.hitSet, '#ff6070', { exclude: player.possess, raw: true }) || solidFor({}, Math.floor(s.x / T), Math.floor(s.y / T)) || s.t > 1.5) {
          s.dead = true; burst(s.x, s.y, 8, ['#ff4060', '#ffb0c0'], 80, { life: 0.25 });
        }
      } else if (s.kind === 'bone') {
        s.vy += 700 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.rot += dt * 14 * Math.sign(s.vx);
        const box = { x: s.x - 5, y: s.y - 5, w: 10, h: 10 };
        if (s.owner === 'possessed') {
          if (strike(box, 12, Math.sign(s.vx), s.hitSet, '#e9e1cf', { exclude: player.possess, raw: true })) s.dead = true;
        } else {
          const c = player.possess;
          if (c && c.alive && overlap(box, c.box())) { damageCreature(c, 10, Math.sign(s.vx)); s.dead = true; }
          else if (!c && player.form !== 'mist' && !player.morph && player.inv <= 0 && overlap(box, boxOf(player))) {
            const from = Math.sign(player.x - s.x) || 1;
            if ((player.act === 'block' && from === -player.face) || player.act === 'cape') {
              player.blockFlash = 0.18; audio.play('block');
              burst(s.x, s.y, 10, ['#ffe08a', '#ffffff'], 120, { life: 0.3 });
            } else hurtPlayer(10, from);
            s.dead = true;
          }
        }
        if (!s.dead && (solidFor({}, Math.floor(s.x / T), Math.floor(s.y / T)) || s.t > 3)) {
          s.dead = true; burst(s.x, s.y, 6, ['#e9e1cf', '#9a917f'], 60, { life: 0.3 });
        }
      } else if (s.kind === 'ring') {
        s.r += 260 * dt;
        for (const en of enemies) {
          if (en.alive === false || s.hitSet.has(en)) continue;
          const b = en.box(), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          if (Math.hypot(cx - s.x, cy - s.y) < s.r) strike(b, 12, Math.sign(cx - s.x) || 1, s.hitSet, '#ff6070');
        }
        if (s.t > 0.55) s.dead = true;
      }
    }
    projs = projs.filter(s => !s.dead);
  }

  function updateItems(dt) {
    for (const it of items) {
      it.t += dt;
      if (it.kind === 'heart' && it.vy > 0) { // corações caem balançando, como no clássico
        it.vy = 40; it.x += Math.sin(it.t * 5) * 30 * dt;
      } else it.vy = Math.min(300, it.vy + 600 * dt);
      const ny = it.y + it.vy * dt;
      const ty = Math.floor(ny / T), tx = Math.floor(it.x / T);
      const v = tileAt(tx, ty);
      if (it.vy > 0 && (v === 1 || v === 3)) { it.y = ty * T; it.vy = 0; it.rest = true; } else if (!it.rest) it.y = ny;
      if (overlap(boxOf(player), { x: it.x - 6, y: it.y - 10, w: 12, h: 10 })) {
        it.dead = true; audio.play('pickup');
        if (it.kind === 'heart') { player.hearts = Math.min(99, player.hearts + 5); dmgText(it.x, it.y - 10, '+5 ♥', '#ff8aa0'); }
        if (it.kind === 'orb') { player.mp = Math.min(player.maxMp, player.mp + 30); dmgText(it.x, it.y - 10, '+30 MP', '#7fc4ff'); }
        if (it.kind === 'potion') { player.hp = Math.min(player.maxHp, player.hp + 40); dmgText(it.x, it.y - 10, '+40 HP', '#9effa8'); }
      }
      if (it.t > 12) it.dead = true;
    }
    items = items.filter(i => !i.dead);
    for (const c of candles) if (!c.alive && (c.t -= dt) <= 0) c.alive = true;
  }

  function updateParticles(dt) {
    for (const q of particles) {
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.grav) q.vy += q.grav * dt;
    }
    particles = particles.filter(q => q.life > 0);
    if (particles.length > 900) particles.splice(0, particles.length - 900);
    for (const t of texts) { t.t += dt; t.y += t.vy * dt; t.vy *= Math.pow(0.05, dt); }
    texts = texts.filter(t => t.t < 0.9);
    for (const a of afterimages) a.life -= dt;
    afterimages = afterimages.filter(a => a.life > 0);
    // poeira no ar
    if (Math.random() < 0.15) particles.push({ x: camX + Math.random() * W, y: 40 + Math.random() * 260, vx: 4 + Math.random() * 6, vy: (Math.random() - 0.5) * 4, life: 4, max: 4, color: '#b8b0d8', size: 1, dust: true });
  }

  // ---------------------------------------------------------------- pose atual do jogador (para desenho)
  function currentPose() {
    const p = player;
    if (p.possess) return null; // a névoa está dentro da criatura
    const pose = (anim, i, o = {}) => ({ f: fr(anim, i), x: p.x, y: p.y, face: p.face, ...o });
    if (p.morph) {
      const m = p.morph, n = ATLAS[m.anim].length;
      let i = Math.min(n - 1, Math.floor(m.t / 0.07));
      if (m.dir < 0) i = n - 1 - i;
      return pose(m.anim, i);
    }
    if (p.form === 'wolf') {
      if (p.act === 'lunge') return pose('wolf_snarl', 0);
      if (p.act === 'howl') return pose('wolf_howl', 0);
      if (!p.onGround) return pose('wolf', 0, { rot: p.vy < 0 ? -0.15 : 0.12, pivot: 22 });
      const run = Math.abs(p.vx) > 10;
      const bob = run ? Math.abs(Math.sin(p.animT * 16)) * -3 : 0;
      return pose('wolf', 0, { y: p.y + bob, sy: run ? 1 + Math.sin(p.animT * 16) * 0.04 : 1 + Math.sin(p.animT * 3) * 0.01 });
    }
    if (p.form === 'bat') {
      const i = Math.floor(p.animT * 9) % 2;
      return pose('bat', i, { y: p.y - p.h / 2 + Math.sin(p.animT * 9) * 2 });
    }
    if (p.form === 'mist') {
      const i = [0, 1, 2, 1][Math.floor(p.animT * 5) % 4];
      return pose('mist', i, { y: p.y - p.h / 2, sx: 0.8, sy: 0.8, alpha: 0.88 });
    }
    // humano
    switch (p.act) {
      case 'throw': return pose('throw', p.actT < 0.1 ? 0 : 1);
      case 'tk': return pose('tk', Math.min(5, Math.floor(p.actT / 0.075)));
      case 'block': return pose('block', p.blockFlash > 0 ? 3 : Math.min(2, Math.floor(p.actT / 0.06)));
      case 'cape': return pose('cape', p.blockFlash > 0 ? 0 : Math.min(1, Math.floor(p.actT / 0.08)));
      case 'aura': {
        const lvl = Math.min(5, Math.floor(p.actT / 0.16));
        return pose('aura', lvl >= 5 ? 4 + Math.floor(p.actT * 8) % 2 : lvl);
      }
      case 'sjump':
        if (!p.launched) return pose('sjump', p.actT < 0.07 ? 0 : 1);
        return pose('sjump', p.vy < -380 ? 2 : 3);
      case 'dash': return pose('stance', 0);
      case 'hurt': return pose('land', 0);
    }
    if (p.flipT > 0) return pose('flip', 0, { rot: (1 - p.flipT / 0.32) * Math.PI * 2, pivot: 38 });
    if (!p.onGround) return pose(p.vy < 0 ? 'jump' : 'fall', 0);
    if (p.landT > 0) return pose('land', 0);
    if (p.crouching) return pose('crouch', p.animT % 1 < 0.08 ? 0 : 1);
    if (Math.abs(p.vx) > 5) return pose('run', Math.floor(p.animT * 12));
    return pose('idle', 0, { sy: 1 + Math.sin(time * 2.4) * 0.008 });
  }

  // ---------------------------------------------------------------- render
  function draw() {
    const g = ctx;
    const sx = shake > 0 ? Math.round((Math.random() - 0.5) * shake * 2) : 0;
    const sy = shake > 0 ? Math.round((Math.random() - 0.5) * shake * 2) : 0;
    const cx = Math.round(camX);
    g.setTransform(1, 0, 0, 1, sx, sy);
    g.imageSmoothingEnabled = false;

    // céu com paralaxe + parede
    g.fillStyle = '#05040b'; g.fillRect(-4, -4, W + 8, H + 8);
    g.drawImage(sky, -Math.round(cx * 0.35), 0);
    g.drawImage(wall, -cx, 0);

    // fachos de luar
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const wx of WINDOWS) {
      const x = wx - cx;
      if (x < -200 || x > W + 50) continue;
      const grd = g.createLinearGradient(0, 120, 0, 330);
      grd.addColorStop(0, 'rgba(120,130,220,.10)'); grd.addColorStop(1, 'rgba(120,130,220,0)');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(x + 4, 110); g.lineTo(x + WIN_W - 4, 110); g.lineTo(x + WIN_W + 90, 320); g.lineTo(x + 40, 320); g.closePath(); g.fill();
    }
    g.restore();

    // velas
    for (const c of candles) drawCandle(g, c);
    // relíquia
    if (!relicTaken) {
      const x = 1180 - cx, y = 270 + Math.sin(time * 3) * 3;
      glow(g, x, y, 22, 'rgba(160,210,255,.45)');
      g.fillStyle = '#e8f6ff'; g.fillRect(x - 3, y - 3, 6, 6);
      g.fillStyle = '#7fc4ff'; g.fillRect(x - 2, y - 5, 4, 1); g.fillRect(x - 2, y + 4, 4, 1);
    }

    for (const en of enemies) en.draw(g);

    // itens
    for (const it of items) {
      const x = Math.round(it.x - cx), y = Math.round(it.y);
      if (it.t > 9 && Math.floor(it.t * 10) % 2) continue;
      const img = it.kind === 'heart' ? HEART : it.kind === 'orb' ? ORB : POTION;
      g.drawImage(img, x - (img.width >> 1), y - img.height);
    }

    // rastro (afterimage) — marca registrada do Alucard
    for (const a of afterimages) drawFrame(g, a.f, a.x - cx, a.y, a.face, { ...a, alpha: (a.life / 0.3) * 0.45, tint: a.color, comp: 'lighter' });

    // jogador
    const pose = currentPose();
    const p = player;
    if (p.buff > 0) glow(g, p.x - cx, p.y - 36, 60, 'rgba(255,90,30,.28)');
    if (p.form === 'mist' && !p.possess) glow(g, p.x - cx, p.y - 15, 40, 'rgba(200,30,60,.25)');
    if (pose) {
      const blink = p.inv > 0 && p.form !== 'mist' && Math.floor(p.inv * 20) % 2 === 0;
      drawFrame(g, pose.f, pose.x - cx, pose.y, pose.face, { ...pose, alpha: blink ? 0.35 : pose.alpha });
      if (p.blockFlash > 0) drawFrame(g, pose.f, pose.x - cx, pose.y, pose.face, { ...pose, alpha: 0.5, tint: '#ffffff', comp: 'lighter' });
    }

    // projéteis
    for (const s of projs) {
      if (s.kind === 'sword') {
        glow(g, s.x - cx, s.y, 24, 'rgba(255,40,70,.35)');
        drawFrame(g, fr('sword', 0), s.x - cx, s.y, s.dir);
      } else if (s.kind === 'fire') {
        glow(g, s.x - cx, s.y, 16, 'rgba(255,140,40,.5)');
        g.fillStyle = '#ffe9a0'; g.fillRect(Math.round(s.x - cx) - 3, Math.round(s.y) - 3, 6, 6);
        g.fillStyle = '#ff7a2a'; g.fillRect(Math.round(s.x - cx) - 2 - Math.sign(s.vx) * 4, Math.round(s.y) - 2, 4, 4);
      } else if (s.kind === 'bfire') {
        glow(g, s.x - cx, s.y, 16, 'rgba(255,40,70,.5)');
        g.fillStyle = '#ffd0d8'; g.fillRect(Math.round(s.x - cx) - 3, Math.round(s.y) - 3, 6, 6);
        g.fillStyle = '#ff2d4a'; g.fillRect(Math.round(s.x - cx) - 2 - Math.sign(s.vx) * 4, Math.round(s.y) - 2, 4, 4);
      } else if (s.kind === 'bone') {
        g.save(); g.translate(Math.round(s.x - cx), Math.round(s.y)); g.rotate(s.rot);
        g.fillStyle = s.owner === 'possessed' ? '#f2c4c4' : '#e9e1cf';
        g.fillRect(-5, -1, 10, 2); g.fillRect(-7, -2, 3, 4); g.fillRect(4, -2, 3, 4);
        g.restore();
      } else if (s.kind === 'ring') {
        g.save(); g.globalCompositeOperation = 'lighter';
        g.strokeStyle = `rgba(255,80,100,${1 - s.t / 0.55})`; g.lineWidth = 3;
        g.beginPath(); g.ellipse(s.x - cx, s.y, s.r, s.r * 0.55, 0, 0, Math.PI * 2); g.stroke();
        g.restore();
      }
    }

    // partículas
    for (const q of particles) {
      const a = clamp(q.life / q.max, 0, 1);
      if (q.dust) { g.globalAlpha = Math.min(a, 1 - a) * 0.6; g.fillStyle = q.color; g.fillRect(Math.round(q.x - cx), Math.round(q.y), 1, 1); continue; }
      g.globalAlpha = a;
      g.globalCompositeOperation = q.add ? 'lighter' : 'source-over';
      g.fillStyle = q.color;
      g.fillRect(Math.round(q.x - cx - q.size / 2), Math.round(q.y - q.size / 2), q.size, q.size);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';

    // grade da frente
    g.drawImage(front, -cx, 0);

    // vinheta
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);

    // números de dano
    for (const t of texts) {
      g.globalAlpha = clamp(1.6 - t.t * 1.8, 0, 1);
      textOut(g, t.s, Math.round(t.x - cx), Math.round(t.y), t.color, 10);
    }
    g.globalAlpha = 1;

    g.setTransform(1, 0, 0, 1, 0, 0);
    drawHUD(g);
  }

  function drawCandle(g, c) {
    const x = Math.round(c.x - camX), y = c.y;
    if (x < -30 || x > W + 30) return;
    // suporte de parede
    g.fillStyle = '#5c4720'; g.fillRect(x - 6, y + 2, 12, 2); g.fillRect(x - 1, y + 4, 2, 6);
    g.fillStyle = '#c9a24d'; g.fillRect(x - 6, y + 2, 12, 1);
    if (!c.alive) return;
    g.fillStyle = '#e9e1cf'; g.fillRect(x - 2, y - 10, 4, 12);
    g.fillStyle = '#b9ab8f'; g.fillRect(x + 1, y - 10, 1, 12);
    const fl = Math.sin(time * 18 + c.x) * 1.2;
    g.fillStyle = '#ff9a2a'; g.fillRect(x - 2, Math.round(y - 16 + fl * 0.3), 4, 5);
    g.fillStyle = '#ffe9a0'; g.fillRect(x - 1, Math.round(y - 15 + fl * 0.3), 2, 3);
    glow(g, x, y - 14, 34 + fl * 2, 'rgba(255,170,70,.30)');
  }

  function drawHUD(g) {
    const p = player;
    // painel de status
    const x = 8, y = 8;
    g.fillStyle = 'rgba(8,6,16,.78)'; g.fillRect(x, y, 152, 44);
    g.strokeStyle = '#7d6430'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 151, 43);
    g.strokeStyle = '#c9a24d'; g.strokeRect(x + 2.5, y + 2.5, 147, 39);
    g.fillStyle = '#c9a24d'; [[x, y], [x + 148, y], [x, y + 40], [x + 148, y + 40]].forEach(([a, b]) => g.fillRect(a, b, 4, 4));
    textOut(g, 'HP', x + 14, y + 13, '#c9a24d', 8);
    textOut(g, String(Math.max(0, Math.ceil(p.hp))).padStart(3, ' '), x + 40, y + 13, '#ffffff', 10);
    bar(g, x + 58, y + 9, 84, 6, p.hp / p.maxHp, '#ff2d4a', '#7a0d1d');
    textOut(g, 'MP', x + 14, y + 25, '#c9a24d', 8);
    bar(g, x + 28, y + 22, 114, 5, p.mp / p.maxMp, '#4fb4ff', '#123a66');
    g.drawImage(HEART, x + 10, y + 32);
    textOut(g, String(p.hearts), x + 30, y + 35, '#ffffff', 8);
    const formName = p.possess ? 'POSSESSÃO' : { human: 'HUMANO', wolf: 'LOBO', bat: 'MORCEGO', mist: 'NÉVOA' }[p.form];
    textOut(g, formName, x + 142, y + 35, p.buff > 0 ? '#ffb347' : '#b8b0d8', 8, 'right');
    let ly = y + 54;
    if (p.possess) {
      const c = p.possess;
      textOut(g, `POSSUINDO: ${c.name}`, x + 6, ly, '#ff6070', 8, 'left');
      bar(g, x + 6, ly + 7, 90, 3, c.hp / c.maxHp, '#ff6070', '#4a0a14');
      ly += 18;
    }
    if (p.buff > 0) { textOut(g, `AURA ${Math.ceil(p.buff)}s`, x + 6, ly, '#ffb347', 8, 'left'); ly += 12; }
    if (relicTaken) textOut(g, '◆ RELÍQUIA DO ECO', x + 6, ly, '#9ed0ff', 8, 'left');

    // minimapa
    const mx = W - 58, my = 10;
    g.fillStyle = 'rgba(8,6,16,.7)'; g.fillRect(mx - 4, my - 4, 52, 22);
    g.fillStyle = '#2346c8'; g.fillRect(mx, my, 44, 14);
    g.strokeStyle = '#ffffff'; g.strokeRect(mx + 0.5, my + 0.5, 43, 13);
    g.fillStyle = '#a7b8ff'; g.fillRect(mx + 22, my + 1, 1, 12);
    if (Math.floor(time * 3) % 2) { g.fillStyle = '#ffffff'; g.fillRect(mx + 2 + Math.round(p.x / ROOM_W * 39), my + 2 + Math.round(clamp(p.y / ROOM_H, 0, 1) * 9), 2, 2); }

    // faixa com o nome da área
    if (banner > 0) {
      const a = clamp(Math.min(banner, 2.5 - banner + 0.4) * 1.5, 0, 1);
      g.globalAlpha = a;
      g.fillStyle = 'rgba(5,4,10,.75)'; g.fillRect(W / 2 - 130, 120, 260, 44);
      g.fillStyle = '#c9a24d'; g.fillRect(W / 2 - 130, 120, 260, 1); g.fillRect(W / 2 - 130, 163, 260, 1);
      g.font = `28px ${GOTHIC_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#000'; g.fillText('Salão dos Ecos', W / 2 + 1, 143);
      g.fillStyle = '#e9e1cf'; g.fillText('Salão dos Ecos', W / 2, 142);
      g.globalAlpha = 1;
    }

    // nome da habilidade
    if (toast) {
      const a = clamp(toast.t * 3, 0, 1);
      g.globalAlpha = a;
      g.font = `10px ${PIXEL_FONT}`;
      const w = g.measureText(toast.name).width + 28;
      g.fillStyle = 'rgba(8,6,16,.85)'; g.fillRect(W / 2 - w / 2, H - 34, w, 20);
      g.strokeStyle = '#c9a24d'; g.strokeRect(W / 2 - w / 2 + 0.5, H - 33.5, w - 1, 19);
      textOut(g, toast.name, W / 2, H - 24, '#ffffff', 10);
      g.globalAlpha = 1;
    }
    if (message) {
      g.globalAlpha = clamp(message.t * 3, 0, 1);
      textOut(g, message.s, W / 2, 70, '#f2d27a', 10);
      g.globalAlpha = 1;
    }
    if (time < 8 && !document.getElementById('wrap').classList.contains('touch')) {
      g.globalAlpha = clamp(8 - time, 0, 1) * 0.85;
      textOut(g, 'ENTER: PAUSA · M: SOM', W - 8, H - 10, '#b8b0d8', 8, 'right');
      g.globalAlpha = 1;
    }
    if (audio.muted) textOut(g, 'SOM DESLIGADO', W - 8, 36, '#b8b0d8', 8, 'right');
  }

  function bar(g, x, y, w, h, v, c1, c2) {
    g.fillStyle = '#000'; g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = c2; g.fillRect(x, y, w, h);
    g.fillStyle = c1; g.fillRect(x, y, Math.round(w * clamp(v, 0, 1)), h);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, y, Math.round(w * clamp(v, 0, 1)), 1);
  }

  // ---------------------------------------------------------------- laço principal
  const pauseEl = document.getElementById('pause');
  function setPaused(v) { paused = v; pauseEl.hidden = !v; }
  document.getElementById('resume').addEventListener('click', () => setPaused(false));

  function step(dt) {
    pressed = pressedQ; pressedQ = new Set();
    if (pressed.has('pause')) setPaused(!paused);
    if (pressed.has('mute')) audio.toggle();
    if (paused) { if (pressed.has('reset')) { resetRoom({}); setPaused(false); } return; }
    if (pressed.has('reset')) resetRoom({});
    time += dt;
    banner -= dt;
    if (toast && (toast.t -= dt) <= 0) toast = null;
    if (message && (message.t -= dt) <= 0) message = null;
    shake = Math.max(0, shake - dt * 20);
    if (hitstop > 0) { hitstop -= dt; return; }
    updatePlayer(dt);
    for (const en of enemies) en.update(dt);
    updateProjs(dt);
    updateItems(dt);
    updateParticles(dt);
    const target = clamp(player.x - W / 2, 0, ROOM_W - W);
    camX += (target - camX) * Math.min(1, dt * 8);
  }

  let last = 0, acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now; acc += dt;
    pollPad();
    while (acc >= DT) { step(DT); acc -= DT; }
    draw();
    requestAnimationFrame(frame);
  }

  function start(data = {}) {
    buildMap(); renderSky(); renderWall(); renderFront();
    resetRoom(data.player ? { ...data.player } : {});
    document.getElementById('loading').hidden = true;
    requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
  }

  // leitura do estado para testes automatizados (somente leitura)
  window.__salao = { get player() { return player; }, get enemies() { return enemies; }, get relic() { return relicTaken; } };

  // recarga a quente no visualizador: guarda a posição e os recursos
  window.claude?.hot?.snapshot?.(() => !player ? {} : ({ player: { x: player.x, y: player.y, face: player.face, hp: player.hp, mp: player.mp, hearts: player.hearts, relic: relicTaken } }));

  function boot(data) {
    let ready = 0;
    const go = () => { if (++ready === 2) start(data); };
    atlasImg.onload = go;
    atlasImg.onerror = () => { document.querySelector('#loading p').textContent = 'Não foi possível carregar assets/atlas.png'; };
    atlasImg.src = 'assets/atlas.png';
    const fonts = document.fonts ? Promise.race([
      Promise.all([document.fonts.load(`10px ${PIXEL_FONT}`), document.fonts.load(`28px ${GOTHIC_FONT}`)]),
      new Promise(r => setTimeout(r, 2500)),
    ]) : Promise.resolve();
    fonts.catch(() => {}).then(go);
  }
  window.claude?.hot?.ready ? window.claude.hot.ready(boot) : boot(window.claude?.hot?.data ?? {});
})();
