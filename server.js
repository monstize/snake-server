// EMOJI SNAKE — servidor autoritativo (WebSocket). O cliente só envia o ângulo desejado;
// posição, velocidade, comida, colisões, mortes e pontuação são decididos aqui.
const http = require('http'), crypto = require('crypto'), { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080, MAP = 3000, TICK = 50, CAP = 20, TARGET = 14, MAXF = 700, SPD = 170, TURN = 5, VR = 750;
const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const EMOJIS = ['🐱','🐸','🐼','🦊','🐵','🐲','👻','🤖','😈','🐙','🐧','🦄','🐢','🐻'];
const BOTN = ['Zeca','Lia','Nuvem','Pixel','Tico','Bia','Rex','Luna','Dudu','Kiko','Mel','Thor'];
const BAD = ['porra','caralho','puta','merda','fdp','viado','buceta','cuzao','nazi','hitler','admin'];
const rnd = (a, b) => a + Math.random() * (b - a), rad = m => Math.min(28, 12 + Math.sqrt(m) * .55);
const clean = s => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14);
const okNick = s => { const n = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e').replace(/4/g,'a').replace(/5/g,'s').replace(/[^a-z]/g, ''); return s.length >= 2 && !BAD.some(w => n.includes(w)); };

function save(s) {                                   // ranking persistente (opcional, via Supabase)
  if (s.bot || !s.tok || !SB || s.peak < 12) return;
  fetch(SB + '/rest/v1/rpc/snake_submit', { method: 'POST', headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_hash: crypto.createHash('sha256').update(s.tok).digest('hex'), p_nick: s.n, p_emoji: s.e, p_score: Math.floor(s.peak), p_len: s.peakL }) }).catch(() => {});
}

class Room {
  constructor(bots = true) { this.sn = new Map(); this.food = []; this.nid = 1; this.tick = 0; this.useBots = bots; this.idle = 0;
    for (let i = 0; i < MAXF * .8; i++) this.addFood();
    if (bots) for (let i = 0; i < 8; i++) this.fillBots(); }
  humans() { let c = 0; for (const s of this.sn.values()) if (!s.bot && s.alive) c++; return c; }
  addFood(x, y, v, c, force) { if (this.food.length >= MAXF + (force ? 300 : 0)) return;
    this.food.push({ x: x ?? rnd(40, MAP - 40), y: y ?? rnd(40, MAP - 40), v: v || 1, c: c ?? (Math.random() * 8 | 0) }); }
  spawn(n, e, bot, ws, tok, x, y) {
    const a = rnd(0, 6.28);
    if (x === undefined) for (let t = 0; t < 25; t++) {            // nasce longe de qualquer outra cobrinha
      x = rnd(300, MAP - 300); y = rnd(300, MAP - 300); let free = true;
      for (const o of this.sn.values()) { for (let i = 0; i < o.segs.length; i += 2) { const q = o.segs[i]; if ((q.x - x) ** 2 + (q.y - y) ** 2 < 250 * 250) { free = false; break; } } if (!free) break; }
      if (free) break; }
    const s = { id: this.nid++, n, e, bot, ws, tok, a, ta: a, m: 10, peak: 10, peakL: 6, alive: true, prot: 60, segs: [], lvl: bot ? Math.random() * 4 | 0 : 0 };
    for (let i = 0; i < 6; i++) s.segs.push({ x: x - Math.cos(a) * i * 10, y: y - Math.sin(a) * i * 10 });
    this.sn.set(s.id, s); return s; }
  move(s, dt) {
    const d = ((s.ta - s.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI, t = TURN * dt; s.a += Math.abs(d) < t ? d : Math.sign(d) * t;
    const h = s.segs[0]; h.x = Math.max(0, Math.min(MAP, h.x + Math.cos(s.a) * SPD * dt)); h.y = Math.max(0, Math.min(MAP, h.y + Math.sin(s.a) * SPD * dt));
    const sp = rad(s.m) * .9, want = Math.min(160, 6 + Math.floor(s.m / 2));
    while (s.segs.length < want) { const l = s.segs[s.segs.length - 1]; s.segs.push({ x: l.x, y: l.y }); }
    for (let i = 1; i < s.segs.length; i++) { const p = s.segs[i - 1], q = s.segs[i], dx = p.x - q.x, dy = p.y - q.y, dd = Math.hypot(dx, dy);
      if (dd > sp) { const k = (dd - sp) / dd; q.x += dx * k; q.y += dy * k; } }
    s.peak = Math.max(s.peak, s.m); s.peakL = Math.max(s.peakL, s.segs.length);
  }
  kill(b, by, eaten) {
    if (!b.alive || b.prot > 0) return; b.alive = false;
    const drop = b.m * (eaten ? .3 : .8), k = Math.min(40, Math.max(3, b.segs.length >> 1));
    for (let j = 0; j < k; j++) { const q = b.segs[(j * 2) % b.segs.length]; this.addFood(q.x + rnd(-8, 8), q.y + rnd(-8, 8), drop / k, Math.random() * 8 | 0, true); }
    if (b.ws && b.ws.readyState === 1) b.ws.send(JSON.stringify({ t: 'dead', score: Math.floor(b.peak), len: b.peakL, by: by ? by.n : null }));
    if (b.ws) b.ws.snake = null; save(b);
  }
  eat(a, b) { if (!a.alive || !b.alive || b.prot > 0) return; a.m += b.m * .5; this.kill(b, a, true); }
  ai(s) {                                            // IA dos bots: níveis 0 (iniciante) a 3 (difícil)
    const h = s.segs[0]; let best = null, bd = 1e12;
    for (const f of this.food) { const d = ((f.x - h.x) ** 2 + (f.y - h.y) ** 2) / f.v; if (d < bd) { bd = d; best = f; } }
    let vx = 0, vy = 0; if (best) { const a = Math.atan2(best.y - h.y, best.x - h.x); vx = Math.cos(a); vy = Math.sin(a); }
    if (s.lvl === 0) { s.ta = Math.atan2(vy, vx) + rnd(-.6, .6); return; }
    let chase = null, cd = (s.lvl >= 3 ? 700 : 500) ** 2;
    for (const o of this.sn.values()) { if (o === s || !o.alive) continue; const oh = o.segs[0];
      const danger = s.m < o.m * 1.5, step = s.lvl >= 3 ? 2 : 3;
      if (danger) for (let i = 0; i < o.segs.length; i += step) { const q = o.segs[i], dx = h.x - q.x, dy = h.y - q.y, d2 = dx * dx + dy * dy, R = i === 0 ? 260 : 120;
        if (d2 < R * R && d2 > 1) { const w = 3 * (R * R - d2) / (R * R) / Math.sqrt(d2); vx += dx * w; vy += dy * w; } }
      if (s.lvl >= 2 && s.m >= o.m * 1.5) { const d2 = (oh.x - h.x) ** 2 + (oh.y - h.y) ** 2; if (d2 < cd) { cd = d2; chase = o; } } }
    if (chase) { const c = chase.segs[0], a = Math.atan2(c.y - h.y + Math.sin(chase.a) * 80, c.x - h.x + Math.cos(chase.a) * 80); vx += Math.cos(a) * 1.5; vy += Math.sin(a) * 1.5; }
    if (h.x < 150) vx += 2; if (h.x > MAP - 150) vx -= 2; if (h.y < 150) vy += 2; if (h.y > MAP - 150) vy -= 2;
    s.ta = Math.atan2(vy, vx);
  }
  step() {
    const dt = TICK / 1000; this.tick++;
    const arr = [...this.sn.values()];
    for (const s of arr) { if (s.prot > 0) s.prot--; if (s.bot && this.tick % 3 === 0) this.ai(s); this.move(s, dt); }
    for (const s of arr) { const h = s.segs[0], R = rad(s.m) + 10;
      for (let i = this.food.length - 1; i >= 0; i--) { const f = this.food[i], dx = f.x - h.x, dy = f.y - h.y;
        if (dx * dx + dy * dy < R * R) { s.m += f.v; this.food[i] = this.food[this.food.length - 1]; this.food.pop(); } } }
    for (const a of arr) { if (!a.alive) continue; const ha = a.segs[0], ra = rad(a.m);
      for (const b of arr) { if (a === b || !a.alive || !b.alive) continue; const hb = b.segs[0], rb = rad(b.m);
        if ((ha.x - hb.x) ** 2 + (ha.y - hb.y) ** 2 < (ra + rb) ** 2 * .5) {          // cabeça x cabeça: o maior (+15%) come; empate = nada
          if (a.m > b.m * 1.15) this.eat(a, b); else if (b.m > a.m * 1.15) this.eat(b, a); continue; }
        const lim = (ra * .6 + rb * .9) ** 2;                                         // cabeça x corpo: quem tem 1,5x a massa come o dono; senão morre quem encostou
        for (let i = 2; i < b.segs.length; i++) { const q = b.segs[i], dx = ha.x - q.x, dy = ha.y - q.y;
          if (dx * dx + dy * dy < lim) { if (a.m >= b.m * 1.5) this.eat(a, b); else this.kill(a, b, false); break; } } } }
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
    for (const s of all) { if (s.bot || !s.ws || s.ws.readyState !== 1) continue; const h = s.segs[0], sn = [], f = [];
      for (const o of all) { const oh = o.segs[0]; if (Math.abs(oh.x - h.x) < VR + 300 && Math.abs(oh.y - h.y) < VR + 300) {
        const sg = []; for (const q of o.segs) sg.push(Math.round(q.x), Math.round(q.y));
        sn.push({ i: o.id, n: o.n, e: o.e, b: o.bot ? 1 : 0, m: Math.floor(o.m), r: +rad(o.m).toFixed(1), s: sg }); } }
      for (const q of this.food) if (Math.abs(q.x - h.x) < VR && Math.abs(q.y - h.y) < VR) f.push(Math.round(q.x), Math.round(q.y), +q.v.toFixed(1), q.c);
      s.ws.send(JSON.stringify({ t: 's', sn, f, lb, mm, on, h: heat })); }
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
    if (!SB) { res.writeHead(200, cors); return res.end(JSON.stringify({ rows: [], off: true })); }
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
    if (m.t === 'join' && !ws.snake) {
      let n = clean(m.nick); if (!okNick(n)) n = 'Jogador' + (Math.random() * 900 + 100 | 0);
      const e = EMOJIS.includes(m.emoji) ? m.emoji : EMOJIS[0], tok = typeof m.tok === 'string' && m.tok.length >= 32 && m.tok.length <= 200 ? m.tok : null;
      ws.room = place(ws); ws.snake = ws.room.spawn(n, e, false, ws, tok); ws.snake.ws = ws;
      ws.send(JSON.stringify({ t: 'init', id: ws.snake.id, map: MAP }));
    }
  });
  ws.on('close', () => { clearInterval(rl); if (ws.snake) { ws.snake.alive = false; ws.snake.ws = null; save(ws.snake); } });
});
setInterval(() => { for (const c of wss.clients) { if (!c.alive) c.terminate(); else { c.alive = false; c.ping(); } } }, 20000);
if (require.main === module) server.listen(PORT, () => console.log('Emoji Snake na porta', PORT));
module.exports = { server, wss, Room, rad, rooms, MAP };
