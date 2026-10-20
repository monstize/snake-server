(() => {
  const NW = window.WebSocket;
  const PAL = ['#34d399', '#38bdf8', '#a78bfa', '#f472b6', '#facc15', '#fb923c', '#f87171', '#22d3ee'];
  const EMOJI_COLORS = {
    '🐱': '#fbbf24', '🐸': '#34d399', '🐼': '#d1d5db', '🦊': '#fbbf24', '🐵': '#f59e0b', '🐲': '#7c3aed', '👻': '#e5e7eb',
    '🤖': '#7dd3fc', '😈': '#ef4444', '🐙': '#f97316', '🐧': '#38bdf8', '🦄': '#c084fc', '🐢': '#4ade80', '🐻': '#a16207',
    '🐍': '#34d399', '🦖': '#a3e635', '🦈': '#60a5fa', '🦁': '#f59e0b', '👑': '#facc15', '🔥': '#f97316', '⚡': '#facc15',
    '🍕': '#fca5a5', '🚀': '#93c5fd', '🐝': '#facc15', '🎃': '#f97316', '🧁': '#f9a8d4', '🍭': '#f472b6', '🍬': '#a78bfa',
    '🍉': '#22c55e', '🍇': '#8b5cf6', '🌙': '#a5b4fc', '⭐': '#facc15', '🎯': '#f87171', '🐰': '#f9a8d4', '🐯': '#fbbf24',
    '🕷️': '#b91c1c', '🧟': '#84cc16', '💀': '#d1d5db', '🦉': '#f59e0b', '🪐': '#60a5fa'
  };
  const EXTRA_EMOJIS = ['🐱', '🐸', '🐼', '🦊', '🐵', '🐲', '👻', '🤖', '😈', '🐙', '🐧', '🦄', '🐢', '🐻', '🐍', '🦖', '🦈', '🦁', '👑', '🔥', '⚡', '🍕', '🚀', '🐝', '🎃', '🧁', '🍭', '🍬', '🍉', '🍇', '🌙', '⭐', '🎯', '🐰', '🐯', '🦉', '🕷️', '🧟', '💀', '🪐'];
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  let sock = null, X = null, ev = null;
  let col = ls.get('es_col', null); if (!Number.isInteger(col) || col < 0 || col > 7) { col = Math.random() * 8 | 0; ls.set('es_col', col); }
  let emoji = ls.get('es_emoji', '🐱'); if (!EXTRA_EMOJIS.includes(emoji)) { emoji = '🐱'; ls.set('es_emoji', emoji); }

  function normalizeEmoji(value) { return EXTRA_EMOJIS.includes(value) ? value : '🐱'; }
  function emojiColor(value) { return EMOJI_COLORS[normalizeEmoji(value)] || '#34d399'; }

  function WS(u, p) {
    const w = p ? new NW(u, p) : new NW(u); sock = w; const os = w.send.bind(w);
    w.send = d => {
      if (typeof d === 'string' && d.startsWith('{"t":"join"')) {
        try {
          const m = JSON.parse(d);
          m.col = Number.isInteger(m.col) && m.col >= 0 && m.col < 8 ? m.col : col;
          m.emoji = normalizeEmoji(m.emoji || emoji);
          d = JSON.stringify(m);
        } catch (_) {}
      }
      return os(d);
    };
    w.addEventListener('message', e => {
      const d = e.data; if (typeof d !== 'string' || d.charCodeAt(0) !== 123) return;
      if (d.startsWith('{"t":"x"')) { try { X = JSON.parse(d); ev = X.ev ? X.ev[0] : null; ui(); } catch (_) {} }
      else if (d.startsWith('{"t":"ev"')) { try { onEv(JSON.parse(d)); } catch (_) {} }
      else if (d.startsWith('{"t":"hit"')) { try { const m = JSON.parse(d); toast((m.k === 'bomb' ? '💣 Bomba! ' : m.k === 'tail' ? '🐍 Sua cauda foi mordida! ' : '💥 Você foi atingido! ') + '−' + m.loss + ' pontos'); } catch (_) {} }
    });
    w.addEventListener('close', () => { if (sock === w) { X = null; ev = null; ui(); } });
    return w;
  }
  WS.prototype = NW.prototype; Object.assign(WS, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); window.WebSocket = WS;

  const css = document.createElement('style');
  css.textContent = `
    .sx{position:fixed;z-index:6;font-family:system-ui,sans-serif;color:#fff;text-shadow:0 0 8px #000}
    #sxb,#sxt{left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:12px;font-weight:800;text-align:center;pointer-events:none;opacity:0;transition:opacity .3s;max-width:92vw;font-size:14px}
    #sxb{top:calc(env(safe-area-inset-top,0px) + 70px);background:#17132bdd;border:1px solid #8b5cf6}#sxt{top:calc(env(safe-area-inset-top,0px) + 120px);background:#7f1d1dcc}
    #sxf{right:136px;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);width:72px;height:72px;border-radius:50%;border:2px solid #f87171;background:#7f1d1dcc;font-size:28px;display:none;cursor:pointer;touch-action:manipulation}
    #sxf small{display:block;font-size:13px;font-weight:800;margin-top:-4px}#sxf.off{opacity:.45}
    #sxm{left:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 64px);width:34px;height:34px;border-radius:50%;border:1px solid #3a3366;background:#17132bcc;font-size:17px;line-height:1;padding:0;cursor:pointer;touch-action:manipulation}
    #sxc,#sxe{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;max-width:320px}#sxc b,#sxe b{width:30px;height:30px;border-radius:50%;border:3px solid transparent;cursor:pointer;font-size:20px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06)}#sxc b.sel,#sxe b.sel{border-color:#fff}
  `;
  document.head.appendChild(css);

  const mk = (tag, id, html) => { const e = document.createElement(tag); e.id = id; e.className = 'sx'; if (html) e.innerHTML = html; document.body.appendChild(e); return e; };
  const bn = mk('div', 'sxb'), ts = mk('div', 'sxt'), fb = mk('button', 'sxf', '🔥<small>0</small>'), mb = mk('button', 'sxm');
  const say = (el, txt, ms, ref) => { el.textContent = txt; el.style.opacity = 1; clearTimeout(ref.t); ref.t = setTimeout(() => el.style.opacity = 0, ms); }, R1 = {}, R2 = {};
  const toast = t => say(ts, t, 2500, R2);

  const MSG = {
    red: '🔴 EVENTO: PODERES VERMELHOS! Colete as bolinhas e atire (🔥 / Espaço)',
    bomb: '💣 EVENTO: BOMBAS no mapa! Desvie delas',
    halloween: '🎃 EVENTO: HALLOWEEN! Música especial e tema do mapa',
    classic: '🐍 EVENTO: SNAKE CLÁSSICO! Todas as cobras viram serpentes'
  };

  function onEv(m) {
    if (m.k === 'start') {
      ev = m.type;
      say(bn, (MSG[m.type] || 'EVENTO') + ' — ' + m.dur + 's', 5000, R1);
      if (m.type === 'halloween') startHalloweenMusic();
    } else {
      say(bn, '✅ Evento encerrado: tudo voltou ao normal', 3500, R1);
      X = null; ev = null; ui();
      if (m.type === 'halloween') stopHalloweenMusic();
    }
  }

  function ui() {
    const on = ev === 'red', c = X ? X.ch | 0 : 0;
    fb.style.display = on ? 'block' : 'none';
    fb.classList.toggle('off', !c || (X && X.cd > 0));
    fb.lastChild.textContent = c;
  }

  function fire() {
    if (ev === 'red' && sock && sock.readyState === 1) sock.send('{"t":"fire"}');
  }
  fb.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fire(); });
  addEventListener('keydown', e => {
    if ((e.code === 'Space' || e.code === 'KeyF') && !e.repeat && document.activeElement.tagName !== 'INPUT') {
      fire();
      if (e.code === 'Space') e.preventDefault();
    }
  });

  function pickEmoji(id) {
    const item = document.getElementById(id);
    if (!item || document.getElementById('sxe')) return;
    const lab = document.createElement('div');
    lab.className = 'm';
    lab.style.cssText = 'color:#9b97b8;font-size:13px;margin-top:4px';
    lab.textContent = 'Emoji da cabeça da cobra';
    const d = document.createElement('div'); d.id = 'sxe';
    EXTRA_EMOJIS.forEach(value => {
      const b = document.createElement('b');
      b.textContent = value;
      b.title = value;
      if (value === emoji) b.className = 'sel';
      b.onclick = () => {
        emoji = value;
        ls.set('es_emoji', emoji);
        [...d.children].forEach(x => x.classList.toggle('sel', x === b));
      };
      d.appendChild(b);
    });
    item.after(lab, d);
  }

  function picker() {
    const a = document.getElementById('eg');
    if (!a || document.getElementById('sxc')) return;
    const lab = document.createElement('div');
    lab.className = 'm';
    lab.style.cssText = 'color:#9b97b8;font-size:13px;margin-top:4px';
    lab.textContent = 'Cor da serpente (aparece no evento Snake clássico)';
    const d = document.createElement('div'); d.id = 'sxc';
    PAL.forEach((c, i) => {
      const b = document.createElement('b');
      b.style.background = c;
      b.title = 'Cor ' + (i + 1);
      if (i === col) b.className = 'sel';
      b.onclick = () => {
        col = i; ls.set('es_col', i);
        [...d.children].forEach(x => x.classList.toggle('sel', x === b));
      };
      d.append(b);
    });
    a.after(lab, d);
    pickEmoji('sxc');
  }
  new MutationObserver(picker).observe(document.documentElement, { childList: true, subtree: true });
  picker();

  const spr = {}, sprite = e => {
    if (spr[e]) return spr[e];
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.font = '50px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, 32, 36);
    return spr[e] = c;
  };

  const HAL = ['🍬', '🍭', '🎃', '🍫', '🧁', '🍩', '👻', '🍪'];
  const DECO = ['🕸️', '🦇', '🪦', '🎃', '👻', '🕯️'];

  window.SnakeExtras = {
    colors: PAL,
    get classic() { return ev === 'classic'; },
    get halloween() { return ev === 'halloween'; },
    bg(ctx, x0, y0, x1, y1) {
      if (ev !== 'halloween') return;
      ctx.fillStyle = 'rgba(95,28,0,.4)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = .55;
      for (let cx = Math.floor(x0 / 360); cx <= x1 / 360; cx++) {
        for (let cy = Math.floor(y0 / 360); cy <= y1 / 360; cy++) {
          const h = ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
          if (h % 3) continue;
          ctx.drawImage(sprite(DECO[h % DECO.length]), cx * 360 + h % 300, cy * 360 + (h >> 8) % 300, 46, 46);
        }
      }
      ctx.globalAlpha = 1;
    },
    food(ctx, fd, now) {
      if (ev !== 'halloween') return false;
      for (let i = 0; i < fd.length; i += 4) {
        const s = 15 + Math.min(fd[i + 2], 8) * 2.4, b = Math.sin(now / 300 + i) * 1.5;
        ctx.drawImage(sprite(HAL[fd[i + 3] % 8]), fd[i] - s, fd[i + 1] - s + b, s * 2, s * 2);
      }
      return true;
    },
    snake(ctx, o, pts, r, me) {
      const selected = normalizeEmoji((o && o.e) || emoji);
      const body = emojiColor(selected);
      const hx = pts[0], hy = pts[1];
      const tail = pts.slice(2);
      if (!tail.length) return true;

      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = r * 2.15; ctx.stroke();
      ctx.strokeStyle = body; ctx.lineWidth = r * 1.8; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = r * .7; ctx.stroke();

      const angle = Math.atan2(hy - pts[3], hx - pts[2]);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const head = sprite(selected);
      ctx.drawImage(head, hx - r * 1.35, hy - r * 1.35, r * 2.7, r * 2.7);
      if (me) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, r * 1.4, 0, 6.28); ctx.stroke();
      }
      for (const sd of [-1, 1]) {
        const ex = hx + cos * r * .45 - sin * sd * r * .55, ey = hy + sin * r * .45 + cos * sd * r * .55;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, r * .42, 0, 6.28); ctx.fill();
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(ex + cos * r * .13, ey + sin * r * .13, r * .21, 0, 6.28); ctx.fill();
      }
      return true;
    },
    draw(ctx, now) {
      if (!X || (ev !== 'red' && ev !== 'bomb')) return;
      const p = Math.sin(now / 180) * 2;
      for (let i = 0; i < X.o.length; i += 2) {
        const x = X.o[i], y = X.o[i + 1];
        ctx.fillStyle = '#ef4444'; ctx.globalAlpha = .3; ctx.beginPath(); ctx.arc(x, y, 22 + p, 0, 6.28); ctx.fill(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, 9 + p / 2, 0, 6.28); ctx.fill(); ctx.fillStyle = '#fecaca'; ctx.beginPath(); ctx.arc(x - 3, y - 3, 3, 0, 6.28); ctx.fill();
      }
      for (let i = 0; i < X.bm.length; i += 2) {
        const x = X.bm[i], y = X.bm[i + 1];
        ctx.strokeStyle = '#facc15'; ctx.globalAlpha = .5 + p / 8; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 24 + p, 0, 6.28); ctx.stroke(); ctx.globalAlpha = 1; ctx.drawImage(sprite('💣'), x - 18, y - 18, 36, 36);
      }
      ctx.fillStyle = '#fca5a5';
      for (let i = 0; i < X.pj.length; i += 2) {
        ctx.globalAlpha = .35; ctx.beginPath(); ctx.arc(X.pj[i], X.pj[i + 1], 14, 0, 6.28); ctx.fill(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(X.pj[i], X.pj[i + 1], 7, 0, 6.28); ctx.fill();
      }
    }
  };

  const HALLOWEEN_URL = 'https://cdn.dbimg.app/ynt0ZJm5.mp3';
  let musicAudio = null, musicEnabled = ls.get('es_music', true);
  mb.textContent = musicEnabled ? '🔊' : '🔇';
  mb.setAttribute('aria-label', 'Ligar/desligar música');

  function ensureMusic() {
    if (!musicAudio) {
      musicAudio = new Audio(HALLOWEEN_URL);
      musicAudio.preload = 'auto';
      musicAudio.loop = true;
      musicAudio.volume = 1;
      musicAudio.muted = !musicEnabled;
      musicAudio.autoplay = false;
    }
  }

  function startHalloweenMusic() {
    if (!musicEnabled) return;
    ensureMusic();
    if (!musicAudio) return;
    if (musicAudio.paused === false) return;
    const tryPlay = () => {
      musicAudio.muted = false;
      musicAudio.currentTime = 0;
      musicAudio.play().catch(() => {});
    };
    tryPlay();
  }

  function stopHalloweenMusic() {
    if (!musicAudio) return;
    musicAudio.pause();
    musicAudio.currentTime = 0;
  }

  mb.addEventListener('pointerdown', e => e.stopPropagation());
  mb.onclick = () => {
    musicEnabled = !musicEnabled;
    ls.set('es_music', musicEnabled);
    mb.textContent = musicEnabled ? '🔊' : '🔇';
    ensureMusic();
    if (!musicAudio) return;
    musicAudio.muted = !musicEnabled;
    if (musicEnabled && ev === 'halloween') startHalloweenMusic();
    else if (!musicEnabled) stopHalloweenMusic();
  };

  const unlock = () => {
    if (musicEnabled && ev === 'halloween') startHalloweenMusic();
  };
  ['pointerdown', 'keydown', 'touchend'].forEach(t => addEventListener(t, unlock, { once: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (musicAudio) musicAudio.pause();
    } else if (musicEnabled && ev === 'halloween') {
      startHalloweenMusic();
    }
  });
})();
