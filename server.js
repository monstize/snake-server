// EMOJI SNAKE v4 — servidor autoritativo (WebSocket). Base: server_v3.js + eventos especiais (poderes vermelhos e bombas).
// O cliente só envia ângulo e "fire"; posição, velocidade, cargas, projéteis, bombas, danos e pontuação são decididos aqui.
const http = require('http'), crypto = require('crypto'), { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080, MAP = 3000, TICK = 50, CAP = 20, TARGET = 14, MAXF = 700, SPD = 170, TURN = 5, VR = 750, BSPD = 270, ST_USE = 28, ST_REG = 14, ST_WAIT = 20;   // boost: 270 px/s, gasta 28%/s, regenera 14%/s após 1 s
const EVT_ENV = +process.env.EVENT_DUR_MS || 0, EVT_GAP = +process.env.EVENT_GAP_MAX_MS || 300000;
const DURS = { red: 60, bomb: 60, halloween: 150, classic: 180, letters: 300 }, evDur = t => Math.round((EVT_ENV || DURS[t] * 1000) / TICK);   // segundos por tipo de evento
const MAXCH = 3, CD = 12, MAXP = 30, NORB = 14, NBOMB = 12, PSPD = 420, DT = TICK / 1000;   // cargas máx., recarga 0,6 s, projéteis máx. por sala
const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const EMOJIS = ['🐱','🐸','🐼','🦊','🐵','🐲','👻','🤖','😈','🐙','🐧','🦄','🐢','🐻','🐍','🦖','🦈','🦁','👑','🔥','⚡','🍕','🚀','🐝',
  '🐶','🐰','🐯','🐨','🐷','🐮','🐔','🦉','🦋','🐬','🐳','🦀','🐞','🦜','🐊','🐘','🦒','🐺','💀','🎃','🍉','🍄','🌵','⭐'];
const BOTN = ['Zeca','Lia','Nuvem','Pixel','Tico','Bia','Rex','Luna','Dudu','Kiko','Mel','Thor'];
const BAD = ['porra','caralho','puta','merda','fdp','viado','buceta','cuzao','nazi','hitler','admin'];
const rnd = (a, b) => a + Math.random() * (b - a), rad = m => Math.min(48, 12 + Math.sqrt(m) * .8);
const clean = s => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14);
const NAMES = ['Tayslaine', 'Gabriel', 'Marcos', 'Daniel'], SPSP = 30, SPS = 150;   // Caça às Letras: nomes sorteados; espaçamento (px) e velocidade da cobra especial
const EMO_RE = /^(?:\p{Extended_Pictographic}[\uFE0F\u{1F3FB}-\u{1F3FF}]?(?:\u200D\p{Extended_Pictographic}[\uFE0F\u{1F3FB}-\u{1F3FF}]?)*)$/u;
const okEmoji = s => typeof s === 'string' && s.length <= 16 && EMO_RE.test(s);   // um único emoji (aceita sequências: pele, bandeira de arco-íris, profissões...)
const okNick = s => { const n = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e').replace(/4/g,'a').replace(/5/g,'s').replace(/[^a-z]/g, ''); return s.length >= 2 && !BAD.some(w => n.includes(w)); };

const fs = require('fs'), RF = process.env.RANK_FILE || '/tmp/snake-rank.json';
let board = []; try { board = JSON.parse(fs.readFileSync(RF, 'utf8')); } catch (e) {}
function local(s) { if (s.bot || s.peak < 12) return; const key = s.tok ? crypto.createHash('sha256').update(s.tok).digest('hex') : 'n:' + s.n.toLowerCase();
  const sc = Math.floor(s.peak), o = board.find(r => r.k === key);
  if (o) { if (sc <= o.best_score) return; Object.assign(o, { nickname: s.n, emoji: s.e, best_score: sc, best_len: s.peakL }); } else board.push({ k: key, nickname: s.n, emoji: s.e, best_score: sc, best_len: s.peakL });
  board.sort((a, b) => b.best_score - a.best_score); board = board.slice(0, 100); rankCache.t = 0; fs.writeFile(RF, JSON.stringify(board), () => {}); }
function save(s) { local(s);                                   // ranking persistente (opcional, via Supabase)
  if (s.bot || !s.tok || !SB || s.peak < 12) return;
  fetch(SB + '/rest/v1/rpc/snake_submit', { method: 'POST', headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_hash: crypto.createHash('sha256').update(s.tok).digest('hex'), p_nick: s.n, p_emoji: s.e, p_score: Math.floor(s.peak), p_len: s.peakL }) }).catch(() => {});
}

class Room {
  constructor(bots = true) { this.sn = new Map(); this.food = []; this.nid = 1; this.tick = 0; this.useBots = bots; this.idle = 0;
    this.ev = null; this.orbs = []; this.bombs = []; this.proj = []; this.nextEv = 0; this.spc = null; this.qs = new Set(); this.evSeq = 0;      // estado dos eventos especiais
    for (let i = 0; i < MAXF * .8; i++) this.addFood();
    if (bots) { for (let i = 0; i < 8; i++) this.fillBots(); this.nextEv = Math.round(rnd(10000, 60000) / TICK); } }
  humans() { let c = 0; for (const s of this.sn.values()) if (!s.bot && s.alive) c++; return c; }
  addFood(x, y, v, c, force) { if (this.food.length >= MAXF + (force ? 300 : 0)) return;
    this.food.push({ x: x ?? rnd(40, MAP - 40), y: y ?? rnd(40, MAP - 40), v: v || 1, c: c ?? (Math.random() * 8 | 0) }); }
  spawn(n, e, bot, ws, tok, x, y, col) {
    const a = rnd(0, 6.28);
    if (x === undefined) for (let t = 0; t < 25; t++) {            // nasce longe de qualquer outra cobrinha
      x = rnd(300, MAP - 300); y = rnd(300, MAP - 300); let free = true;
      for (const o of this.sn.values()) { for (let i = 0; i < o.segs.length; i += 2) { const q = o.segs[i]; if ((q.x - x) ** 2 + (q.y - y) ** 2 < 250 * 250) { free = false; break; } } if (!free) break; }
      if (free) break; }
    const s = { id: this.nid++, n, e, bot, ws, tok, a, ta: a, m: 10, peak: 10, peakL: 6, alive: true, st: 100, bst: 0, boost: false, sw: 0, prot: 60, ch: 0, cd: 0, col: Number.isInteger(col) && col >= 0 && col < 8 ? col : Math.random() * 8 | 0, segs: [], lvl: bot ? Math.random() * 4 | 0 : 0 };
    for (let i = 0; i < 6; i++) s.segs.push({ x: x - Math.cos(a) * i * 10, y: y - Math.sin(a) * i * 10 });
    this.sn.set(s.id, s); return s; }
  move(s, dt) {
    const d = ((s.ta - s.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI, t = TURN * dt; s.a += Math.abs(d) < t ? d : Math.sign(d) * t;
    const on = s.boost && s.st > 0; s.bst = on ? 1 : 0;                                   // boost com stamina (servidor decide)
    if (on) { s.st = Math.max(0, s.st - ST_USE * dt); s.sw = ST_WAIT; } else if (s.sw > 0) s.sw--; else s.st = Math.min(100, s.st + ST_REG * dt);
    const v = on ? BSPD : SPD, h = s.segs[0], nx = h.x + Math.cos(s.a) * v * dt, ny = h.y + Math.sin(s.a) * v * dt;
    if (nx <= 0 || ny <= 0 || nx >= MAP || ny >= MAP) { if (s.bot) { s.a += Math.PI; s.ta = s.a; return; } s.prot = 0; s.wall = true; return this.kill(s, null, false); }
    h.x = nx; h.y = ny;
    const sp = rad(s.m) * .9, want = Math.max(6, Math.min(160, 6 + Math.floor(s.m / 2)) - (s.cut | 0));   // s.cut = pedaços de cauda perdidos em tiros/bombas (voltam aos poucos)
    if (s.cut > 0 && this.tick % 6 === 0) s.cut--;
    while (s.segs.length < want) { const l = s.segs[s.segs.length - 1]; s.segs.push({ x: l.x, y: l.y }); }
    while (s.segs.length > want && s.segs.length > 6) s.segs.pop();                 // perda de massa encurta a cauda
    const rigid = this.ev && this.ev.type === 'classic';            // Snake clássico: espaçamento fixo, o corpo segue o caminho da cabeça sem encolher nas curvas
    for (let i = 1; i < s.segs.length; i++) { const p = s.segs[i - 1], q = s.segs[i], dx = p.x - q.x, dy = p.y - q.y, dd = Math.hypot(dx, dy);
      if (dd > sp || (rigid && dd > 1e-3 && dd < sp * .6)) { const k = (dd - sp) / dd; q.x += dx * k; q.y += dy * k; } }
    s.peak = Math.max(s.peak, s.m); s.peakL = Math.max(s.peakL, s.segs.length);
  }
  kill(b, by, eaten) {
    if (!b.alive || b.prot > 0) return; b.alive = false;
    const drop = b.m * (eaten ? .3 : .8), k = Math.min(40, Math.max(3, b.segs.length >> 1));
    for (let j = 0; j < k; j++) { const q = b.segs[(j * 2) % b.segs.length]; this.addFood(q.x + rnd(-8, 8), q.y + rnd(-8, 8), drop / k, Math.random() * 8 | 0, true); }
    if (b.ws && b.ws.readyState === 1) b.ws.send(JSON.stringify({ t: 'dead', score: Math.floor(b.peak), len: b.peakL, by: by ? by.n : null, wall: !!b.wall }));
    if (b.ws) b.ws.snake = null; save(b);
  }
  eat(a, b, full) { if (!a.alive || !b.alive || b.prot > 0) return; a.m += b.m * (full ? 1 : .5); this.kill(b, a, true);
    if (a.ws && a.ws.readyState === 1 && this.tick - (a.ch_t | 0) >= 2) { a.ch_t = this.tick; a.ws.send('{"t":"chomp"}'); } }   // som de mordida só para quem comeu
  classicHits(arr) {                                  // Snake clássico (calculado só aqui no servidor): corpo/cauda matam sempre; cabeça x cabeça o maior come o menor
    const segD2 = (px, py, A, B) => { const vx = B.x - A.x, vy = B.y - A.y, l = vx * vx + vy * vy; let t = l ? ((px - A.x) * vx + (py - A.y) * vy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const x = A.x + vx * t - px, y = A.y + vy * t - py; return x * x + y * y; };
    const dead = new Map(), eats = [], clash = new Set();
    for (let i = 0; i < arr.length; i++) { const a = arr[i]; if (!a.alive) continue; const ha = a.segs[0], ra = rad(a.m);
      for (let j = i + 1; j < arr.length; j++) { const b = arr[j]; if (!b.alive) continue; const hb = b.segs[0], rb = rad(b.m);
        if ((ha.x - hb.x) ** 2 + (ha.y - hb.y) ** 2 < ((ra + rb) * .8) ** 2) { clash.add(a.id + ':' + b.id); clash.add(b.id + ':' + a.id);
          if (a.m > b.m) eats.push([a, b]); else if (b.m > a.m) eats.push([b, a]); else { dead.set(a, b); dead.set(b, a); } } } }
    for (const [w, l] of eats) if (!dead.has(w)) { dead.delete(l); l._eaten = w; }
    for (const a of arr) { if (!a.alive || a._eaten || dead.has(a) || a.prot > 0) continue; const h = a.segs[0], ra = rad(a.m), sp = ra * .9;
      for (const b of arr) { if (!b.alive || b.segs.length < 2) continue; const rb = rad(b.m), self = a === b; if (clash.has(a.id + ':' + b.id)) continue;   // confronto de cabeças já decidido acima
        const from = self ? Math.max(4, Math.ceil((Math.PI * BSPD / TURN + ra * 2.2) / sp)) : 1;    // ignora o trecho logo atrás da cabeça (curva mais fechada possível)
        const lim = (self ? ra * .7 : ra * .55 + rb * .75) ** 2;
        for (let k = from; k < b.segs.length; k++) if (segD2(h.x, h.y, b.segs[k - 1], b.segs[k]) < lim) { dead.set(a, self ? null : b); break; }
        if (dead.has(a)) break; } }
    for (const a of arr) if (a._eaten) { const w = a._eaten; delete a._eaten; if (w.alive && !dead.has(w)) this.eat(w, a, true); }
    for (const [a, by] of dead) this.kill(a, by, false); }

  /* ---------- EVENTOS ESPECIAIS ---------- */
  tell(o) { const j = JSON.stringify(o); for (const s of this.sn.values()) if (!s.bot && s.ws && s.ws.readyState === 1) s.ws.send(j); }
  hurt(o, frac, kind) {                                  // perde cauda e pontos, NUNCA morre (massa mínima 10)
    const loss = Math.min(o.m - 10, Math.max(4, o.m * frac)); if (loss <= 0) return 0; o.m -= loss;
    const n = Math.min(Math.max(4, Math.round(o.segs.length * frac)), o.segs.length - 6);                    // cauda perdida (visível mesmo em cobras gigantes)
    for (let i = 0; i < n; i++) o.segs.pop(); o.cut = (o.cut | 0) + n;
    const t = o.segs[o.segs.length - 1]; for (let i = 0; i < 4; i++) this.addFood(t.x + rnd(-20, 20), t.y + rnd(-20, 20), loss * .5 / 4, Math.random() * 8 | 0, true);
    if (o.ws && o.ws.readyState === 1) o.ws.send(JSON.stringify({ t: 'hit', k: kind, loss: Math.round(loss) }));
    return loss; }
  fire(s) {                                              // tiro na direção em que a cobrinha realmente está indo (decidido no servidor)
    if (!this.ev || this.ev.type !== 'red' || !s.alive || s.ch <= 0 || this.tick < s.cd || this.proj.length >= MAXP) return false;
    s.ch--; s.cd = this.tick + CD; const h = s.segs[0], r = rad(s.m) + 14;
    this.proj.push({ x: h.x + Math.cos(s.a) * r, y: h.y + Math.sin(s.a) * r, a: s.a, id: s.id, life: 30 }); return true; }
  startEvent(force, fname) {                             // os 5 eventos são sorteados com a mesma chance, sem depender de pontuação
    const pool = ['red', 'bomb', 'halloween', 'classic', 'letters'], type = force || pool[Math.random() * pool.length | 0], d = evDur(type); this.ev = { type, end: this.tick + d, id: ++this.evSeq };
    if (type === 'letters') { this.ev.name = fname || NAMES[Math.random() * NAMES.length | 0]; this.spc = this.makeSpecial(this.ev.name); for (const s of this.sn.values()) if (!s.bot && s.alive && s.ws) this.makeQuest(s.ws); }
    this.tell({ t: 'ev', k: 'start', type, dur: Math.round(d * TICK / 1000), name: this.ev.name }); }
  endEvent() { const type = this.ev.type; this.ev = null; this.orbs = []; this.bombs = []; this.proj = [];
    for (const s of this.sn.values()) s.ch = 0;
    this.spc = null; for (const w of this.qs) w.quest = null; this.qs.clear();      // fim do evento: some a cobra especial e o progresso de todos
    this.nextEv = this.tick + Math.round(rnd(Math.min(10000, EVT_GAP), EVT_GAP) / TICK);      // pausa aleatória de até 5 min
    this.tell({ t: 'ev', k: 'end', type }); }
  /* ---------- CAÇA ÀS LETRAS ---------- */
  makeQuest(ws) {                                        // progresso PRÓPRIO de cada jogador: letras só dele, uma por posição do nome (repetidas incluídas)
    const up = this.ev.name.toUpperCase(), pts = [];
    for (let i = 0; i < up.length; i++) { let p; for (let t = 0; t < 40; t++) { p = { x: rnd(160, MAP - 160), y: rnd(160, MAP - 160) }; if (pts.every(q => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 > 320 * 320)) break; } pts.push({ x: p.x, y: p.y, i, ch: up[i], got: false }); }
    ws.quest = { evId: this.ev.id, room: this, letters: pts, mask: 0, done: false, complete: false }; this.qs.add(ws); return ws.quest; }
  joinQuest(ws) { const q = ws.quest; if (this.ev && this.ev.type === 'letters') { if (!(q && q.room === this && q.evId === this.ev.id)) this.makeQuest(ws); } else ws.quest = null; }   // quem morre e volta no mesmo evento mantém o progresso; quem entra no meio começa do zero
  makeSpecial(name) { const n = name.length, x = rnd(400, MAP - 400), y = rnd(400, MAP - 400), a = rnd(0, 6.28);
    return { name, a, wx: x, wy: y, wt: 0, segs: Array.from({ length: n }, (_, i) => ({ x: x - Math.cos(a) * i * SPSP, y: y - Math.sin(a) * i * SPSP })) }; }   // 1 segmento por letra do nome
  lettersStep(arr) {
    const sp = this.spc;
    if (sp) {                                            // cobra especial: IA que percorre o mapa; não come, não mata, não morre e não entra nas colisões
      const h = sp.segs[0];
      if (this.tick >= sp.wt || (sp.wx - h.x) ** 2 + (sp.wy - h.y) ** 2 < 150 * 150) { sp.wx = rnd(250, MAP - 250); sp.wy = rnd(250, MAP - 250); sp.wt = this.tick + 200; }
      const ta = Math.atan2(sp.wy - h.y, sp.wx - h.x), d = ((ta - sp.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI, t = 3 * DT; sp.a += Math.abs(d) < t ? d : Math.sign(d) * t;
      h.x = Math.max(120, Math.min(MAP - 120, h.x + Math.cos(sp.a) * SPS * DT)); h.y = Math.max(120, Math.min(MAP - 120, h.y + Math.sin(sp.a) * SPS * DT));
      for (let i = 1; i < sp.segs.length; i++) { const p = sp.segs[i - 1], q = sp.segs[i], dx = p.x - q.x, dy = p.y - q.y, dd = Math.hypot(dx, dy) || 1; const k = (dd - SPSP) / dd; q.x += dx * k; q.y += dy * k; } }
    for (const s of arr) { if (s.bot || !s.alive || !s.ws || !s.ws.quest) continue; const q = s.ws.quest, h = s.segs[0], R = rad(s.m) + 16;
      if (!q.done) {
        for (const L of q.letters) if (!L.got && (L.x - h.x) ** 2 + (L.y - h.y) ** 2 < R * R) { L.got = true; q.mask |= 1 << L.i; }
        if (q.mask === (1 << q.letters.length) - 1) { q.done = true; s.ws.send('{"t":"quest","k":"name"}'); }
      } else if (!q.complete && sp) { const R2 = (rad(s.m) + 22) ** 2;
        if (sp.segs.some(g => (g.x - h.x) ** 2 + (g.y - h.y) ** 2 < R2)) { q.complete = true; s.ws.send('{"t":"quest","k":"done"}'); } } } }
  lettersFor(s, h) {                                     // o que ESTE jogador vê: só as letras dele que faltam, o progresso dele e (depois do nome completo) a posição da cobra no minimapa
    const q = s.ws && s.ws.quest, sp = this.spc; if (!q) return null;
    const lt = []; if (!q.done) for (const L of q.letters) if (!L.got && Math.abs(L.x - h.x) < VR && Math.abs(L.y - h.y) < VR) lt.push(Math.round(L.x), Math.round(L.y), L.i);
    const r = { nm: this.ev.name, lt, lg: q.mask, ld: q.done ? 1 : 0, lc: q.complete ? 1 : 0 };
    if (sp && Math.abs(sp.segs[0].x - h.x) < VR + 200 && Math.abs(sp.segs[0].y - h.y) < VR + 200) { const p = []; for (const g of sp.segs) p.push(Math.round(g.x), Math.round(g.y)); r.sp = p; }   // todos veem a cobra no mundo, sincronizada
    if (q.done && !q.complete && sp) r.sm = [Math.round(sp.segs[0].x), Math.round(sp.segs[0].y)];
    return r; }
  events() {
    const e = this.ev, arr = [...this.sn.values()];
    if (!e) { if (this.tick >= this.nextEv && this.tick % 20 === 0 && arr.some(s => !s.bot && s.alive)) this.startEvent(); return; }
    if (this.tick >= e.end) return this.endEvent();
    if (e.type === 'letters') { this.lettersStep(arr); return; }
    if (e.type === 'red' || e.type === 'bomb') { const list = e.type === 'red' ? this.orbs : this.bombs, want = e.type === 'red' ? NORB : NBOMB;
      while (list.length < want) list.push({ x: rnd(120, MAP - 120), y: rnd(120, MAP - 120) }); }
    if (e.type === 'red') {
      for (const s of arr) { if (!s.alive || s.ch >= MAXCH) continue; const h = s.segs[0], R = rad(s.m) + 12;
        for (let i = this.orbs.length - 1; i >= 0; i--) { const o = this.orbs[i]; if ((o.x - h.x) ** 2 + (o.y - h.y) ** 2 < R * R) { s.ch++; this.orbs.splice(i, 1); break; } } }
      for (let i = this.proj.length - 1; i >= 0; i--) { const p = this.proj[i]; p.x += Math.cos(p.a) * PSPD * DT; p.y += Math.sin(p.a) * PSPD * DT;
        let done = --p.life <= 0 || p.x < 0 || p.y < 0 || p.x > MAP || p.y > MAP;
        if (!done) for (const o of arr) { if (o.id === p.id || !o.alive || o.prot > 0) continue; const R2 = (rad(o.m) * .8 + 8) ** 2;
          for (const q of o.segs) if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < R2) { this.hurt(o, .15, 'shot'); done = true; break; } if (done) break; }
        if (done) this.proj.splice(i, 1); }
    } else if (e.type === 'bomb') for (const s of arr) { if (!s.alive || s.prot > 0) continue; const h = s.segs[0], R = rad(s.m) + 16;
      for (let i = this.bombs.length - 1; i >= 0; i--) { const b = this.bombs[i]; if ((b.x - h.x) ** 2 + (b.y - h.y) ** 2 < R * R) { this.hurt(s, .2, 'bomb'); this.bombs.splice(i, 1); break; } } }
  }

  ai(s) {                                            // IA dos bots: níveis 0 (iniciante) a 3 (difícil)
    const h = s.segs[0], red = this.ev && this.ev.type === 'red'; let best = null, bd = 1e12;
    for (const f of this.food) { const d = ((f.x - h.x) ** 2 + (f.y - h.y) ** 2) / f.v; if (d < bd) { bd = d; best = f; } }
    if (red && s.ch < MAXCH) { let od = 700 * 700; for (const o of this.orbs) { const d = (o.x - h.x) ** 2 + (o.y - h.y) ** 2; if (d < od) { od = d; best = o; } } }   // bots também coletam as bolinhas vermelhas
    let vx = 0, vy = 0; if (best) { const a = Math.atan2(best.y - h.y, best.x - h.x); vx = Math.cos(a); vy = Math.sin(a); }
    if (this.ev && this.ev.type === 'bomb') for (const b of this.bombs) { const dx = h.x - b.x, dy = h.y - b.y, d2 = dx * dx + dy * dy, R = 170;   // todos os bots desviam das bombas
      if (d2 < R * R && d2 > 1) { const w = 4 * (R * R - d2) / (R * R) / Math.sqrt(d2); vx += dx * w; vy += dy * w; } }
    if (s.lvl === 0) { s.boost = false; s.ta = Math.atan2(vy, vx) + rnd(-.6, .6); return; }
    let flee = 0;
    let chase = null, cd = (s.lvl >= 3 ? 700 : 500) ** 2;
    for (const o of this.sn.values()) { if (o === s || !o.alive) continue; const oh = o.segs[0];
      const danger = s.m < o.m * 1.5, step = s.lvl >= 3 ? 2 : 3;
      if (danger) for (let i = 0; i < o.segs.length; i += step) { const q = o.segs[i], dx = h.x - q.x, dy = h.y - q.y, d2 = dx * dx + dy * dy, R = i === 0 ? 260 : 120;
        if (d2 < R * R && d2 > 1) { const w = 3 * (R * R - d2) / (R * R) / Math.sqrt(d2); vx += dx * w; vy += dy * w; if (d2 < 150 * 150) flee++; } }
      if (s.lvl >= 2 && s.m >= o.m * 1.5) { const d2 = (oh.x - h.x) ** 2 + (oh.y - h.y) ** 2; if (d2 < cd) { cd = d2; chase = o; } } }
    if (chase) { const c = chase.segs[0], a = Math.atan2(c.y - h.y + Math.sin(chase.a) * 80, c.x - h.x + Math.cos(chase.a) w = a._eaten; delete a._eaten; if (w.alive && !dead.has(w)) this.eat(w, a, true); }
    for (const [a, by] of dead) this.kill(a, by, false); }

  /* ---------- EVENTOS ESPECIAIS ---------- */
  tell(o) { const j = JSON.stringify(o); for (const s of this.sn.values()) if (!s.bot && s.ws && s.ws.readyState === 1) s.ws.send(j); }
  hurt(o, frac, kind) {                                  // perde cauda e pontos, NUNCA morre (massa mínima 10)
    const loss = Math.min(o.m - 10, Math.max(4, o.m * frac)); if (loss <= 0) return 0; o.m -= loss;
    const n = Math.min(Math.max(4, Math.round(o.segs.length * frac)), o.segs.length - 6);                    // cauda perdida (visível mesmo em cobras gigantes)
    for (let i = 0; i < n; i++) o.segs.pop(); o.cut = (o.cut | 0) + n;
    const t = o.segs[o.segs.length - 1]; for (let i = 0; i < 4; i++) this.addFood(t.x + rnd(-20, 20), t.y + rnd(-20, 20), loss * .5 / 4, Math.random() * 8 | 0, true);
    if (o.ws && o.ws.readyState === 1) o.ws.send(JSON.stringify({ t: 'hit', k: kind, loss: Math.round(loss) }));
    return loss; }
  fire(s) {                                              // tiro na direção em que a cobrinha realmente está indo (decidido no servidor)
    if (!this.ev || this.ev.type !== 'red' || !s.alive || s.ch <= 0 || this.tick < s.cd || this.proj.length >= MAXP) return false;
    s.ch--; s.cd = this.tick + CD; const h = s.segs[0], r = rad(s.m) + 14;
    this.proj.push({ x: h.x + Math.cos(s.a) * r, y: h.y + Math.sin(s.a) * r, a: s.a, id: s.id, life: 30 }); return true; }
  startEvent(force, fname) {                             // os 5 eventos são sorteados com a mesma chance, sem depender de pontuação
    const pool = ['red', 'bomb', 'halloween', 'classic', 'letters'], type = force || pool[Math.random() * pool.length | 0], d = evDur(type); this.ev = { type, end: this.tick + d, id: ++this.evSeq };
    if (type === 'letters') { this.ev.name = fname || NAMES[Math.random() * NAMES.length | 0]; this.spc = this.makeSpecial(this.ev.name); for (const s of this.sn.values()) if (!s.bot && s.alive && s.ws) this.makeQuest(s.ws); }
    this.tell({ t: 'ev', k: 'start', type, dur: Math.round(d * TICK / 1000), name: this.ev.name }); }
  endEvent() { const type = this.ev.type; this.ev = null; this.orbs = []; this.bombs = []; this.proj = [];
    for (const s of this.sn.values()) s.ch = 0;
    this.spc = null; for (const w of this.qs) w.quest = null; this.qs.clear();      // fim do evento: some a cobra especial e o progresso de todos
    this.nextEv = this.tick + Math.round(rnd(Math.min(10000, EVT_GAP), EVT_GAP) / TICK);      // pausa aleatória de até 5 min
    this.tell({ t: 'ev', k: 'end', type }); }
  /* ---------- CAÇA ÀS LETRAS ---------- */
  makeQuest(ws) {                                        // progresso PRÓPRIO de cada jogador: letras só dele, uma por posição do nome (repetidas incluídas)
    const up = this.ev.name.toUpperCase(), pts = [];
    for (let i = 0; i < up.length; i++) { let p; for (let t = 0; t < 40; t++) { p = { x: rnd(160, MAP - 160), y: rnd(160, MAP - 160) }; if (pts.every(q => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 > 320 * 320)) break; } pts.push({ x: p.x, y: p.y, i, ch: up[i], got: false }); }
    ws.quest = { evId: this.ev.id, room: this, letters: pts, mask: 0, done: false, complete: false }; this.qs.add(ws); return ws.quest; }
  joinQuest(ws) { const q = ws.quest; if (this.ev && this.ev.type === 'letters') { if (!(q && q.room === this && q.evId === this.ev.id)) this.makeQuest(ws); } else ws.quest = null; }   // quem morre e volta no mesmo evento mantém o progresso; quem entra no meio começa do zero
  makeSpecial(name) { const n = name.length, x = rnd(400, MAP - 400), y = rnd(400, MAP - 400), a = rnd(0, 6.28);
    return { name, a, wx: x, wy: y, wt: 0, segs: Array.from({ length: n }, (_, i) => ({ x: x - Math.cos(a) * i * SPSP, y: y - Math.sin(a) * i * SPSP })) }; }   // 1 segmento por letra do nome
  lettersStep(arr) {
    const sp = this.spc;
    if (sp) {                                            // cobra especial: IA que percorre o mapa; não come, não mata, não morre e não entra nas colisões
      const h = sp.segs[0];
      if (this.tick >= sp.wt || (sp.wx - h.x) ** 2 + (sp.wy - h.y) ** 2 < 150 * 150) { sp.wx = rnd(250, MAP - 250); sp.wy = rnd(250, MAP - 250); sp.wt = this.tick + 200; }
      const ta = Math.atan2(sp.wy - h.y, sp.wx - h.x), d = ((ta - sp.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI, t = 3 * DT; sp.a += Math.abs(d) < t ? d : Math.sign(d) * t;
      h.x = Math.max(120, Math.min(MAP - 120, h.x + Math.cos(sp.a) * SPS * DT)); h.y = Math.max(120, Math.min(MAP - 120, h.y + Math.sin(sp.a) * SPS * DT));
      for (let i = 1; i < sp.segs.length; i++) { const p = sp.segs[i - 1], q = sp.segs[i], dx = p.x - q.x, dy = p.y - q.y, dd = Math.hypot(dx, dy) || 1; const k = (dd - SPSP) / dd; q.x += dx * k; q.y += dy * k; } }
    for (const s of arr) { if (s.bot || !s.alive || !s.ws || !s.ws.quest) continue; const q = s.ws.quest, h = s.segs[0], R = rad(s.m) + 16;
      if (!q.done) {
        for (const L of q.letters) if (!L.got && (L.x - h.x) ** 2 + (L.y - h.y) ** 2 < R * R) { L.got = true; q.mask |= 1 << L.i; }
        if (q.mask === (1 << q.letters.length) - 1) { q.done = true; s.ws.send('{"t":"quest","k":"name"}'); }
      } else if (!q.complete && sp) { const R2 = (rad(s.m) + 22) ** 2;
        if (sp.segs.some(g => (g.x - h.x) ** 2 + (g.y - h.y) ** 2 < R2)) { q.complete = true; s.ws.send('{"t":"quest","k":"done"}'); } } } }
  lettersFor(s, h) {                                     // o que ESTE jogador vê: só as letras dele que faltam, o progresso dele e (depois do nome completo) a posição da cobra no minimapa
    const q = s.ws && s.ws.quest, sp = this.spc; if (!q) return null;
    const lt = []; if (!q.done) for (const L of q.letters) if (!L.got && Math.abs(L.x - h.x) < VR && Math.abs(L.y - h.y) < VR) lt.push(Math.round(L.x), Math.round(L.y), L.i);
    const r = { nm: this.ev.name, lt, lg: q.mask, ld: q.done ? 1 : 0, lc: q.complete ? 1 : 0 };
    if (sp && Math.abs(sp.segs[0].x - h.x) < VR + 200 && Math.abs(sp.segs[0].y - h.y) < VR + 200) { const p = []; for (const g of sp.segs) p.push(Math.round(g.x), Math.round(g.y)); r.sp = p; }   // todos veem a cobra no mundo, sincronizada
    if (q.done && !q.complete && sp) r.sm = [Math.round(sp.segs[0].x), Math.round(sp.segs[0].y)];
    return r; }
  events() {
    const e = this.ev, arr = [...this.sn.values()];
    if (!e) { if (this.tick >= this.nextEv && this.tick % 20 === 0 && arr.some(s => !s.bot && s.alive)) this.startEvent(); return; }
    if (this.tick >= e.end) return this.endEvent();
    if (e.type === 'letters') { this.lettersStep(arr); return; }
    if (e.type === 'red' || e.type === 'bomb') { const list = e.type === 'red' ? this.orbs : this.bombs, want = e.type === 'red' ? NORB : NBOMB;
      while (list.length < want) list.push({ x: rnd(120, MAP - 120), y: rnd(120, MAP - 120) }); }
    if (e.type === 'red') {
      for (const s of arr) { if (!s.alive || s.ch >= MAXCH) continue; const h = s.segs[0], R = rad(s.m) + 12;
        for (let i = this.orbs.length - 1; i >= 0; i--) { const o = this.orbs[i]; if ((o.x - h.x) ** 2 + (o.y - h.y) ** 2 < R * R) { s.ch++; this.orbs.splice(i, 1); break; } } }
      for (let i = this.proj.length - 1; i >= 0; i--) { const p = this.proj[i]; p.x += Math.cos(p.a) * PSPD * DT; p.y += Math.sin(p.a) * PSPD * DT;
        let done = --p.life <= 0 || p.x < 0 || p.y < 0 || p.x > MAP || p.y > MAP;
        if (!done) for (const o of arr) { if (o.id === p.id || !o.alive || o.prot > 0) continue; const R2 = (rad(o.m) * .8 + 8) ** 2;
          for (const q of o.segs) if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < R2) { this.hurt(o, .15, 'shot'); done = true; break; } if (done) break; }
        if (done) this.proj.splice(i, 1); }
    } else if (e.type === 'bomb') for (const s of arr) { if (!s.alive || s.prot > 0) continue; const h = s.segs[0], R = rad(s.m) + 16;
      for (let i = this.bombs.length - 1; i >= 0; i--) { const b = this.bombs[i]; if ((b.x - h.x) ** 2 + (b.y - h.y) ** 2 < R * R) { this.hurt(s, .2, 'bomb'); this.bombs.splice(i, 1); break; } } }
  }

  ai(s) {                                            // IA dos bots: níveis 0 (iniciante) a 3 (difícil)
    const h = s.segs[0], red = this.ev && this.ev.type === 'red'; let best = null, bd = 1e12;
    for (const f of this.food) { const d = ((f.x - h.x) ** 2 + (f.y - h.y) ** 2) / f.v; if (d < bd) { bd = d; best = f; } }
    if (red && s.ch < MAXCH) { let od = 700 * 700; for (const o of this.orbs) { const d = (o.x - h.x) ** 2 + (o.y - h.y) ** 2; if (d < od) { od = d; best = o; } } }   // bots também coletam as bolinhas vermelhas
    let vx = 0, vy = 0; if (best) { const a = Math.atan2(best.y - h.y, best.x - h.x); vx = Math.cos(a); vy = Math.sin(a); }
    if (this.ev && this.ev.type === 'bomb') for (const b of this.bombs) { const dx = h.x - b.x, dy = h.y - b.y, d2 = dx * dx + dy * dy, R = 170;   // todos os bots desviam das bombas
      if (d2 < R * R && d2 > 1) { const w = 4 * (R * R - d2) / (R * R) / Math.sqrt(d2); vx += dx * w; vy += dy * w; } }
    if (s.lvl === 0) { s.boost = false; s.ta = Math.atan2(vy, vx) + rnd(-.6, .6); return; }
    let flee = 0;
    let chase = null, cd = (s.lvl >= 3 ? 700 : 500) ** 2;
    for (const o of this.sn.values()) { if (o === s || !o.alive) continue; const oh = o.segs[0];
      const danger = s.m < o.m * 1.5, step = s.lvl >= 3 ? 2 : 3;
      if (danger) for (let i = 0; i < o.segs.length; i += step) { const q = o.segs[i], dx = h.x - q.x, dy = h.y - q.y, d2 = dx * dx + dy * dy, R = i === 0 ? 260 : 120;
        if (d2 < R * R && d2 > 1) { const w = 3 * (R * R - d2) / (R * R) / Math.sqrt(d2); vx += dx * w; vy += dy * w; if (d2 < 150 * 150) flee++; } }
      if (s.lvl >= 2 && s.m >= o.m * 1.5) { const d2 = (oh.x - h.x) ** 2 + (oh.y - h.y) ** 2; if (d2 < cd) { cd = d2; chase = o; } } }
    if (chase) { const c = chase.segs[0], a = Math.atan2(c.y - h.y + Math.sin(chase.a) * 80, c.x - h.x + Math.cos(chase.a)   const loss = Math.min(o.m - 10, Math.max(4, o.m * frac)); if (loss <= 0) return 0; o.m -= loss;
    const n = Math.min(Math.max(4, Math.round(o.segs.length * frac)), o.segs.length - 6);                    // cauda perdida (visível mesmo em cobras gigantes)
    for (let i = 0; i < n; i++) o.segs.pop(); o.cut = (o.cut | 0) + n;
    const t = o.segs[o.segs.length - 1]; for (let i = 0; i < 4; i++) this.addFood(t.x + rnd(-20, 20), t.y + rnd(-20, 20), loss * .5 / 4, Math.random() * 8 | 0, true);
    if (o.ws && o.ws.readyState === 1) o.ws.send(JSON.stringify({ t: 'hit', k: kind, loss: Math.round(loss) }));
    return loss; }
  fire(s) {                                              // tiro na direção em que a cobrinha realmente está indo (decidido no servidor)
    if (!this.ev || this.ev.type !== 'red' || !s.alive || s.ch <= 0 || this.tick < s.cd || this.proj.length >= MAXP) return false;
    s.ch--; s.cd = this.tick + CD; const h = s.segs[0], r = rad(s.m) + 14;
    this.proj.push({ x: h.x + Math.cos(s.a) * r, y: h.y + Math.sin(s.a) * r, a: s.a, id: s.id, life: 30 }); return true; }
  startEvent(force, fname) {                             // os 5 eventos são sorteados com a mesma chance, sem depender de pontuação
    const pool = ['red', 'bomb', 'halloween', 'classic', 'letters'], type = force || pool[Math.random() * pool.length | 0], d = evDur(type); this.ev = { type, end: this.tick + d, id: ++this.evSeq };
    if (type === 'letters') { this.ev.name = fname || NAMES[Math.random() * NAMES.length | 0]; this.spc = this.makeSpecial(this.ev.name); for (const s of this.sn.values()) if (!s.bot && s.alive && s.ws) this.makeQuest(s.ws); }
    this.tell({ t: 'ev', k: 'start', type, dur: Math.round(d * TICK / 1000), name: this.ev.name }); }
  endEvent() { const type = this.ev.type; this.ev = null; this.orbs = []; this.bombs = []; this.proj = [];
    for (const s of this.sn.values()) s.ch = 0;
    this.spc = null; for (const w of this.qs) w.quest = null; this.qs.clear();      // fim do evento: some a cobra especial e o progresso de todos
    this.nextEv = this.tick + Math.round(rnd(Math.min(10000, EVT_GAP), EVT_GAP) / TICK);      // pausa aleatória de até 5 min
    this.tell({ t: 'ev', k: 'end', type }); }
  /* ---------- CAÇA ÀS LETRAS ---------- */
  makeQuest(ws) {                                        // progresso PRÓPRIO de cada jogador: letras só dele, uma por posição do nome (repetidas incluídas)
    const up = this.ev.name.toUpperCase(), pts = [];
    for (let i = 0; i < up.length; i++) { let p; for (let t = 0; t < 40; t++) { p = { x: rnd(160, MAP - 160), y: rnd(160, MAP - 160) }; if (pts.every(q => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 > 320 * 320)) break; } pts.push({ x: p.x, y: p.y, i, ch: up[i], got: false }); }
    ws.quest = { evId: this.ev.id, room: this, letters: pts, mask: 0, done: false, complete: false }; this.qs.add(ws); return ws.quest; }
  joinQuest(ws) { const q = ws.quest; if (this.ev && this.ev.type === 'letters') { if (!(q && q.room === this && q.evId === this.ev.id)) this.makeQuest(ws); } else ws.quest = null; }   // quem morre e volta no mesmo evento mantém o progresso; quem entra no meio começa do zero
  makeSpecial(name) { const n = name.length, x = rnd(400, MAP - 400), y = rnd(400, MAP - 400), a = rnd(0, 6.28);
    return { name, a, wx: x, wy: y, wt: 0, segs: Array.from({ length: n }, (_, i) => ({ x: x - Math.cos(a) * i * SPSP, y: y - Math.sin(a) * i * SPSP })) }; }   // 1 segmento por letra do nome
  lettersStep(arr) {
    const sp = this.spc;
    if (sp) {                                            // cobra especial: IA que percorre o mapa; não come, não mata, não morre e não entra nas colisões
      const h = sp.segs[0];
      if (this.tick >= sp.wt || (sp.wx - h.x) ** 2 + (sp.wy - h.y) ** 2 < 150 * 150) { sp.wx = rnd(250, MAP - 250); sp.wy = rnd(250, MAP - 250); sp.wt = this.tick + 200; }
      const ta = Math.atan2(sp.wy - h.y, sp.wx - h.x), d = ((ta - sp.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI, t = 3 * DT; sp.a += Math.abs(d) < t ? d : Math.sign(d) * t;
      h.x = Math.max(120, Math.min(MAP - 120, h.x + Math.cos(sp.a) * SPS * DT)); h.y = Math.max(120, Math.min(MAP - 120, h.y + Math.sin(sp.a) * SPS * DT));
      for (let i = 1; i < sp.segs.length; i++) { const p = sp.segs[i - 1], q = sp.segs[i], dx = p.x - q.x, dy = p.y - q.y, dd = Math.hypot(dx, dy) || 1; const k = (dd - SPSP) / dd; q.x += dx * k; q.y += dy * k; } }
    for (const s of arr) { if (s.bot || !s.alive || !s.ws || !s.ws.quest) continue; const q = s.ws.quest, h = s.segs[0], R = rad(s.m) + 16;
      if (!q.done) {
        for (const L of q.letters) if (!L.got && (L.x - h.x) ** 2 + (L.y - h.y) ** 2 < R * R) { L.got = true; q.mask |= 1 << L.i; }
        if (q.mask === (1 << q.letters.length) - 1) { q.done = true; s.ws.send('{"t":"quest","k":"name"}'); }
      } else if (!q.complete && sp) { const R2 = (rad(s.m) + 22) ** 2;
        if (sp.segs.some(g => (g.x - h.x) ** 2 + (g.y - h.y) ** 2 < R2)) { q.complete = true; s.ws.send('{"t":"quest","k":"done"}'); } } } }
  lettersFor(s, h) {                                     // o que ESTE jogador vê: só as letras dele que faltam, o progresso dele e (depois do nome completo) a posição da cobra no minimapa
    const q = s.ws && s.ws.quest, sp = this.spc; if (!q) return null;
    const lt = []; if (!q.done) for (const L of q.letters) if (!L.got && Math.abs(L.x - h.x) < VR && Math.abs(L.y - h.y) < VR) lt.push(Math.round(L.x), Math.round(L.y), L.i);
    const r = { nm: this.ev.name, lt, lg: q.mask, ld: q.done ? 1 : 0, lc: q.complete ? 1 : 0 };
    if (sp && Math.abs(sp.segs[0].x - h.x) < VR + 200 && Math.abs(sp.segs[0].y - h.y) < VR + 200) { const p = []; for (const g of sp.segs) p.push(Math.round(g.x), Math.round(g.y)); r.sp = p; }   // todos veem a cobra no mundo, sincronizada
    if (q.done && !q.complete && sp) r.sm = [Math.round(sp.segs[0].x), Math.round(sp.segs[0].y)];
    return r; }
  events() {
    const e = this.ev, arr = [...this.sn.values()];
    if (!e) { if (this.tick >= this.nextEv && this.tick % 20 === 0 && arr.some(s => !s.bot && s.alive)) this.startEvent(); return; }
    if (this.tick >= e.end) return this.endEvent();
    if (e.type === 'letters') { this.lettersStep(arr); return; }
    if (e.type === 'red' || e.type === 'bomb') { const list = e.type === 'red' ? this.orbs : this.bombs, want = e.type === 'red' ? NORB : NBOMB;
      while (list.length < want) list.push({ x: rnd(120, MAP - 120), y: rnd(120, MAP - 120) }); }
    if (e.type === 'red') {
      for (const s of arr) { if (!s.alive || s.ch >= MAXCH) continue; const h = s.segs[0], R = rad(s.m) + 12;
        for (let i = this.orbs.length - 1; i >= 0; i--) { const o = this.orbs[i]; if ((o.x - h.x) ** 2 + (o.y - h.y) ** 2 < R * R) { s.ch++; this.orbs.splice(i, 1); break; } } }
      for (let i = this.proj.length - 1; i >= 0; i--) { const p = this.proj[i]; p.x += Math.cos(p.a) * PSPD * DT; p.y += Math.sin(p.a) * PSPD * DT;
        let done = --p.life <= 0 || p.x < 0 || p.y < 0 || p.x > MAP || p.y > MAP;
        if (!done) for (const o of arr) { if (o.id === p.id || !o.alive || o.prot > 0) continue; const R2 = (rad(o.m) * .8 + 8) ** 2;
          for (const q of o.segs) if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < R2) { this.hurt(o, .15, 'shot'); done = true; break; } if (done) break; }
        if (done) this.proj.splice(i, 1); }
    } else if (e.type === 'bomb') for (const s of arr) { if (!s.alive || s.prot > 0) continue; const h = s.segs[0], R = rad(s.m) + 16;
      for (let i = this.bombs.length - 1; i >= 0; i--) { const b = this.bombs[i]; if ((b.x - h.x) ** 2 + (b.y - h.y) ** 2 < R * R) { this.hurt(s, .2, 'bomb'); this.bombs.splice(i, 1); break; } } }
  }

  ai(s) {                                            // IA dos bots: níveis 0 (iniciante) a 3 (difícil)
    const h = s.segs[0], red = this.ev && this.ev.type === 'red'; let best = null, bd = 1e12;
    for (const f of this.food) { const d = ((f.x - h.x) ** 2 + (f.y - h.y) ** 2) / f.v; if (d < bd) { bd = d; best = f; } }
    if (red && s.ch < MAXCH) { let od = 700 * 700; for (const o of this.orbs) { const d = (o.x - h.x) ** 2 + (o.y - h.y) ** 2; if (d < od) { od = d; best = o; } } }   // bots também coletam as bolinhas vermelhas
    let vx = 0, vy = 0; if (best) { const a = Math.atan2(best.y - h.y, best.x - h.x); vx = Math.cos(a); vy = Math.sin(a); }
    if (this.ev && this.ev.type === 'bomb') for (const b of this.bombs) { const dx = h.x - b.x, dy = h.y - b.y, d2 = dx * dx + dy * dy, R = 170;   // todos os bots desviam das bombas
      if (d2 < R * R && d2 > 1) { const w = 4 * (R * R - d2) / (R * R) / Math.sqrt(d2); vx += dx * w; vy += dy * w; } }
    if (s.lvl === 0) { s.ta = Math.atan2(vy, vx) + rnd(-.6, .6); return; }
    let chase = null, cd = (s.lvl >= 3 ? 700 : 500) ** 2;
    for (const o of this.sn.values()) { if (o === s || !o.alive) continue; const oh = o.segs[0];
      const danger = s.m < o.m * 1.5, step = s.lvl >= 3 ? 2 : 3;
      if (danger) for (let i = 0; i < o.segs.length; i += step) { const q = o.segs[i], dx = h.x - q.x, dy = h.y - q.y, d2 = dx * dx + dy * dy, R = i === 0 ? 260 : 120;
        if (d2 < R * R && d2 > 1) { const w = 3 * (R * R - d2) / (R * R) / Math.sqrt(d2); vx += dx * w; vy += dy * w; } }
      if (s.lvl >= 2 && s.m >= o.m * 1.5) { const d2 = (oh.x - h.x) ** 2 + (oh.y - h.y) ** 2; if (d2 < cd) { cd = d2; chase = o; } } }
    if (chase) { const c = chase.segs[0], a = Math.atan2(c.y - h.y + Math.sin(chase.a) * 80, c.x - h.x + Math.cos(chase.a) * 80); vx += Math.cos(a) * 1.5; vy += Math.sin(a) * 1.5; }
    if (h.x < 150) vx += 2; if (h.x > MAP - 150) vx -= 2; if (h.y < 150) vy += 2; if (h.y > MAP - 150) vy -= 2;
    if (red && s.ch > 0 && this.tick >= s.cd && Math.random() < .6) for (const o of this.sn.values()) {        // bots (nível 1+) atiram em quem está à frente
      if (o === s || !o.alive || o.prot > 0) continue; const oh = o.segs[0], dx = oh.x - h.x, dy = oh.y - h.y;
      if (dx * dx + dy * dy < 450 * 450 && Math.abs(((Math.atan2nd(JSON.stringify({ t: 'hit', k: kind, loss: Math.round(loss) }));
    return loss; }
  fire(s) {                                              // tiro na direção em que a cobrinha realmente está indo (decidido no servidor)
    if (!this.ev || this.ev.type !== 'red' || !s.alive || s.ch <= 0 || this.tick < s.cd || this.proj.length >= MAXP) return false;
    s.ch--; s.cd = this.tick + CD; const h = s.segs[0], r = rad(s.m) + 14;
    this.proj.push({ x: h.x + Math.cos(s.a) * r, y: h.y + Math.sin(s.a) * r, a: s.a, id: s.id, life: 30 }); return true; }
  startEvent(force) {                                    // os 4 eventos são sorteados com a mesma chance, sem depender de pontuação
    const pool = ['red', 'bomb', 'halloween', 'classic'], type = force || pool[Math.random() * pool.length | 0], d = evDur(type); this.ev = { type, end: this.tick + d };
    this.tell({ t: 'ev', k: 'start', type, dur: Math.round(d * TICK / 1000) }); }
  endEvent() { const type = this.ev.type; this.ev = null; this.orbs = []; this.bombs = []; this.proj = [];
    for (const s of this.sn.values()) s.ch = 0;
    this.nextEv = this.tick + Math.round(rnd(Math.min(10000, EVT_GAP), EVT_GAP) / TICK);      // pausa aleatória de até 5 min
    this.tell({ t: 'ev', k: 'end', type }); }
  events() {
    const e = this.ev, arr = [...this.sn.values()];
    if (!e) { if (this.tick >= this.nextEv && this.tick % 20 === 0 && arr.some(s => !s.bot && s.alive)) this.startEvent(); return; }
    if (this.tick >= e.end) return this.endEvent();
    if (e.type === 'red' || e.type === 'bomb') { const list = e.type === 'red' ? this.orbs : this.bombs, want = e.type === 'red' ? NORB : NBOMB;
      while (list.length < want) list.push({ x: rnd(120, MAP - 120), y: rnd(120, MAP - 120) }); }
    if (e.type === 'red') {
      for (const s of arr) { if (!s.alive || s.ch >= MAXCH) continue; const h = s.segs[0], R = rad(s.m) + 12;
        for (let i = this.orbs.length - 1; i >= 0; i--) { const o = this.orbs[i]; if ((o.x - h.x) ** 2 + (o.y - h.y) ** 2 < R * R) { s.ch++; this.orbs.splice(i, 1); break; } } }
      for (let i = this.proj.length - 1; i >= 0; i--) { const p = this.proj[i]; p.x += Math.cos(p.a) * PSPD * DT; p.y += Math.sin(p.a) * PSPD * DT;
        let done = --p.life <= 0 || p.x < 0 || p.y < 0 || p.x > MAP || p.y > MAP;
        if (!done) for (const o of arr) { if (o.id === p.id || !o.alive || o.prot > 0) continue; const R2 = (rad(o.m) * .8 + 8) ** 2;
          for (const q of o.segs) if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < R2) { this.hurt(o, .15, 'shot'); done = true; break; } if (done) break; }
        if (done) this.proj.splice(i, 1); }
    } else if (e.type === 'bomb') for (const s of arr) { if (!s.alive || s.prot > 0) continue; const h = s.segs[0], R = rad(s.m) + 16;
      for (let i = this.bombs.length - 1; i >= 0; i--) { const b = this.bombs[i]; if ((b.x - h.x) ** 2 + (b.y - h.y) ** 2 < R * R) { this.hurt(s, .2, 'bomb'); this.bombs.splice(i, 1); break; } } }
  }

  ai(s) {                                            // IA dos bots: níveis 0 (iniciante) a 3 (difícil)
    const h = s.segs[0], red = this.ev && this.ev.type === 'red'; let best = null, bd = 1e12;
    for (const f of this.food) { const d = ((f.x - h.x) ** 2 + (f.y - h.y) ** 2) / f.v; if (d < bd) { bd = d; best = f; } }
    if (red && s.ch < MAXCH) { let od = 700 * 700; for (const o of this.orbs) { const d = (o.x - h.x) ** 2 + (o.y - h.y) ** 2; if (d < od) { od = d; best = o; } } }   // bots também coletam as bolinhas vermelhas
    let vx = 0, vy = 0; if (best) { const a = Math.atan2(best.y - h.y, best.x - h.x); vx = Math.cos(a); vy = Math.sin(a); }
    if (this.ev && this.ev.type === 'bomb') for (const b of this.bombs) { const dx = h.x - b.x, dy = h.y - b.y, d2 = dx * dx + dy * dy, R = 170;   // todos os bots desviam das bombas
      if (d2 < R * R && d2 > 1) { const w = 4 * (R * R - d2) / (R * R) / Math.sqrt(d2); vx += dx * w; vy += dy * w; } }
    if (s.lvl === 0) { s.ta = Math.atan2(vy, vx) + rnd(-.6, .6); return; }
    let chase = null, cd = (s.lvl >= 3 ? 700 : 500) ** 2;
    for (const o of this.sn.values()) { if (o === s || !o.alive) continue; const oh = o.segs[0];
      const danger = s.m < o.m * 1.5, step = s.lvl >= 3 ? 2 : 3;
      if (danger) for (let i = 0; i < o.segs.length; i += step) { const q = o.segs[i], dx = h.x - q.x, dy = h.y - q.y, d2 = dx * dx + dy * dy, R = i === 0 ? 260 : 120;
        if (d2 < R * R && d2 > 1) { const w = 3 * (R * R - d2) / (R * R) / Math.sqrt(d2); vx += dx * w; vy += dy * w; } }
      if (s.lvl >= 2 && s.m >= o.m * 1.5) { const d2 = (oh.x - h.x) ** 2 + (oh.y - h.y) ** 2; if (d2 < cd) { cd = d2; chase = o; } } }
    if (chase) { const c = chase.segs[0], a = Math.atan2(c.y - h.y + Math.sin(chase.a) * 80, c.x - h.x + Math.cos(chase.a) * 80); vx += Math.cos(a) * 1.5; vy += Math.sin(a) * 1.5; }
    if (h.x < 150) vx += 2; if (h.x > MAP - 150) vx -= 2; if (h.y < 150) vy += 2; if (h.y > MAP - 150) vy -= 2;
    if (red && s.ch > 0 && this.tick >= s.cd && Math.random() < .6) for (const o of this.sn.values()) {        // bots (nível 1+) atiram em quem está à frente
      if (o === s || !o.alive || o.prot > 0) continue; const oh = o.segs[0], dx = oh.x - h.x, dy = oh.y - h.y;
      if (dx * dx + dy * dy < 450 * 450 && Math.abs(((Math.atan2(dy, dx) - s.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < .3) { this.fire(s); break; } }
    s.ta = Math.atan2(vy, vx);
  }
  wear(a, b, dx, dy, ra, rb) {                       // a ponta da cauda é "sólida" (a cabeça não atravessa) e perde segmentos e massa aos poucos
    if (b.prot > 0) return;
    const d = Math.hypot(dx, dy) || 1, L = ra * .5 + rb * .7, h = a.segs[0];
    if (d < L) { h.x = Math.max(0, Math.min(MAP, h.x + dx / d * (L - d))); h.y = Math.max(0, Math.min(MAP, h.y + dy / d * (L - d))); }
    if (this.tick - (a.bite | 0) < 4 || b.segs.length <= 6 || b.m <= 10) return; a.bite = this.tick;
    const g = Math.min(Math.max(2, b.m * .01), b.m - 10), n = Math.min(2, b.segs.length - 6), t = b.segs[b.segs.length - 1];
    b.m -= g; a.m += g / 2; for (let i = 0; i < n; i++) b.segs.pop(); b.cut = (b.cut | 0) + n; this.addFood(t.x, t.y, g / 2, Math.random() * 8 | 0, true);
    if (b.ws && b.ws.readyState === 1 && this.tick - (b.hm | 0) >= 20) { b.hm = this.tick; b.ws.send(JSON.stringify({ t: 'hit', k: 'tail', loss: Math.round(g) })); }
  }
  step() {
    const dt = TICK / 1000; this.tick++;
    const arr = [...this.sn.values()];
    for (const s of arr) { if (s.prot > 0) s.prot--; if (s.bot && this.tick % 3 === 0) this.ai(s); this.move(s, dt); }
    for (const s of arr) { const h = s.segs[0], R = rad(s.m) + 10;
      for (let i = this.food.length - 1; i >= 0; i--) { const f = this.food[i], dx = f.x - h.x, dy = f.y - h.y;
        if (dx * dx + dy * dy < R * R) { s.m += f.v; this.food[i] = this.food[this.food.length - 1]; this.food.pop(); } } }
    this.events();
    if (this.ev && this.ev.type === 'classic') this.classicHits(arr); else
    for (const a of arr) { if (!a.alive) continue; const ha = a.segs[0], ra = rad(a.m);
      for (const b of arr) { if (a === b || !a.alive || !b.alive) continue; const hb = b.segs[0], rb = rad(b.m);
        if ((ha.x - hb.x) ** 2 + (ha.y - hb.y) ** 2 < (ra + rb) ** 2 * .5) {          // cabeça x cabeça: o maior (+15%) come; empate = nada
          if (a.m > b.m * 1.15) this.eat(a, b); else if (b.m > a.m * 1.15) this.eat(b, a); continue; }
        const lim = (ra * .5 + rb * .7) ** 2;                                         // cabeça x corpo (hitbox mais justa)
        const tip = b.segs.length - Math.max(2, Math.round(b.segs.length * .2));      // ponta da cauda = últimos 20% dos segmentos (mín. 2)
        for (let i = 3; i < b.segs.length; i++) { const q = b.segs[i], dx = ha.x - q.x, dy = ha.y - q.y;
          if (dx * dx + dy * dy < lim) {
            if (i >= tip) { let bj = i, bd = dx * dx + dy * dy; for (let j = tip; j < b.segs.length; j++) { const e = b.segs[j], ex = ha.x - e.x, ey = ha.y - e.y, ed = ex * ex + ey * ey; if (ed < bd) { bd = ed; bj = j; } }
              this.wear(a, b, ha.x - b.segs[bj].x, ha.y - b.segs[bj].y, ra, rb); }   // ponta da cauda: desgaste gradual, ninguém morre
            else if (a.m > b.m * 1.15) this.eat(a, b);                                // corpo: o maior come o dono
            else this.kill(a, b, false);                                              // corpo: o menor que bate morre
            break; } } } }
    for (const [id, s] of this.sn) if (!s.alive) this.sn.delete(id);
    for (let i = 0; i < 4 && this.food.length < MAXF * .8; i++) this.addFood();
    if (this.useBots && this.tick % 40 === 0) this.fillBots();
    this.idle = this.humans() ? 0 : this.idle + 1;
    this.broadcast();
  }
  fillBots() {
    const want = Math.max(4, TARGET - this.humans()), bots = [...this.sn.values()].filter(s => s.bot);
    if (bots.length < want) this.spawn('🤖 ' + BOTN[Math.random() * BOTN.length | 0], EMOJIS[Math.random() * EMOJIS.length | 0], true);
    else if (bots.length > want) this.sn.delete(bots[0].id);
  }
  broadcast() {
    const all = [...this.sn.values()], lb = all.slice().sort((a, b) => b.m - a.m).slice(0, 5).map(s => [s.n, s.e, Math.floor(s.m), s.bot ? 1 : 0]);
    const mm = all.map(s => [Math.round(s.segs[0].x), Math.round(s.segs[0].y), Math.floor(s.m), s.id, s.bot ? 1 : 0]), on = this.humans();
    let heat; if (this.tick % 20 === 0) { const n = 10, c = new Array(n * n).fill(0), cs = MAP / n; for (const f of this.food) c[Math.min(n - 1, f.y / cs | 0) * n + Math.min(n - 1, f.x / cs | 0)]++; heat = { n, c }; }
    const hum = all.filter(s => !s.bot && s.alive);
    for (const s of hum) { const above = new Set(hum.filter(o => o !== s && o.m > s.m).map(o => o.id));
      if (s.above && s.ws && s.ws.readyState === 1) for (const id of above) if (!s.above.has(id)) { const o = this.sn.get(id); if (o) s.ws.send(JSON.stringify({ t: 'pass', n: o.n, e: o.e })); }
      s.above = above; }
    for (const s of all) { if (s.bot || !s.ws || s.ws.readyState !== 1) continue; const h = s.segs[0], sn = [], f = [];
      for (const o of all) { if (o.segs.some(q => Math.abs(q.x - h.x) < VR + 300 && Math.abs(q.y - h.y) < VR + 300)) {
        const sg = []; for (const q of o.segs) sg.push(Math.round(q.x), Math.round(q.y));
        sn.push({ i: o.id, n: o.n, e: o.e, c: o.col, b: o.bot ? 1 : 0, m: Math.floor(o.m), r: +rad(o.m).toFixed(1), s: sg }); } }
      for (const q of this.food) if (Math.abs(q.x - h.x) < VR && Math.abs(q.y - h.y) < VR) f.push(Math.round(q.x), Math.round(q.y), +q.v.toFixed(1), q.c);
      s.ws.send(JSON.stringify({ t: 's', sn, f, lb, mm, on, h: heat }));
      if (this.ev) { const vw = l => { const r = []; for (const q of l) if (Math.abs(q.x - h.x) < VR && Math.abs(q.y - h.y) < VR) r.push(Math.round(q.x), Math.round(q.y)); return r; };
        s.ws.send(JSON.stringify({ t: 'x', ev: [this.ev.type, Math.ceil((this.ev.end - this.tick) * TICK / 1000)], o: vw(this.orbs), bm: vw(this.bombs), pj: vw(this.proj), ch: s.ch, cd: Math.max(0, s.cd - this.tick) * TICK })); } }
  }
}

const rooms = [];
function place(ws) { let r = rooms.find(r => r.humans() < CAP); if (!r) { r = new Room(); r.timer = setInterval(() => r.step(), TICK); rooms.push(r); } return r; }
setInterval(() => { for (let i = rooms.length - 1; i > 0; i--) if (rooms[i].idle > 1200) { clearInterval(rooms[i].timer); rooms.splice(i, 1); } }, 10000);

let rankCache = { t: 0, rows: [] };
const server = http.createServer(async (req, res) => {
  const o = req.headers.origin, cors = { 'Access-Control-Allow-Origin': !ORIGINS.length ? '*' : ORIGINS.includes(o) ? o : ORIGINS[0], 'Vary': 'Origin', 'Content-Type': 'application/json' };
  if (req.url === '/health') { res.writeHead(200, cors); return res.end('{"ok":true}'); }
  if (req.url === '/ranking') {
    if (!SB) { res.writeHead(200, cors); return res.end(JSON.stringify({ rows: board.map(({ k, ...r }) => r) })); }
    if (Date.now() - rankCache.t > 10000) { try {
      const r = await fetch(SB + '/rest/v1/snake_scores?select=nickname,emoji,best_score,best_len&order=best_score.desc&limit=100', { headers: { apikey: SK, Authorization: 'Bearer ' + SK } });
      if (r.ok) rankCache = { t: Date.now(), rows: await r.json() }; } catch (e) {} }
    res.writeHead(200, cors); return res.end(JSON.stringify({ rows: rankCache.rows })); }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 512, verifyClient: i => !ORIGINS.length || !i.origin || ORIGINS.includes(i.origin) });
wss.on('connection', ws => {
  ws.cnt = 0; const rl = setInterval(() => ws.cnt = 0, 1000); ws.snake = null; ws.alive = true; ws.on('pong', () => ws.alive = true);
  ws.on('message', raw => {
    if (++ws.cnt > 60) return ws.terminate();              // limite de mensagens/s
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'in') { if (ws.snake && Number.isFinite(m.a)) ws.snake.ta = m.a; return; }   // só o ângulo; velocidade é do servidor
    if (m.t === 'fire') { if (ws.snake && ws.room) ws.room.fire(ws.snake); return; }          // validação (evento, cargas, recarga) feita no servidor
    if (m.t === 'join' && !ws.snake) {
      let n = clean(m.nick); if (!okNick(n)) n = 'Jogador' + (Math.random() * 900 + 100 | 0);
      const e = EMOJIS.includes(m.emoji) ? m.emoji : EMOJIS[0], tok = typeof m.tok === 'string' && m.tok.length >= 32 && m.tok.length <= 200 ? m.tok : null;
      ws.room = place(ws); { const bt = [...ws.room.sn.values()].find(b => b.bot); if (bt) ws.room.sn.delete(bt.id); } ws.snake = ws.room.spawn(n, e, false, ws, tok, undefined, undefined, m.col); ws.snake.ws = ws;
      ws.send(JSON.stringify({ t: 'init', id: ws.snake.id, map: MAP }));
      const ev = ws.room.ev; if (ev) ws.send(JSON.stringify({ t: 'ev', k: 'start', type: ev.type, dur: Math.ceil((ev.end - ws.room.tick) * TICK / 1000), late: 1 }));
    }
  });
  ws.on('close', () => { clearInterval(rl); if (ws.snake) { ws.snake.alive = false; ws.snake.ws = null; save(ws.snake); if (ws.room && ws.room.useBots) ws.room.fillBots(); } });
});
setInterval(() => { for (const c of wss.clients) { if (!c.alive) c.terminate(); else { c.alive = false; c.ping(); } } }, 20000);
if (require.main === module) server.listen(PORT, () => console.log('Emoji Snake na porta', PORT));
module.exports = { server, wss, Room, rad, rooms, MAP };
