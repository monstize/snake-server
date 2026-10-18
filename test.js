const WebSocket = require('ws'); const { server, wss, Room, rad } = require('./server');
let ok = 0, tot = 0; const eq = (n, c) => { tot++; if (c) ok++; console.log(c ? 'OK  ' : 'FAIL', n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(port) { return new Promise(res => { const ws = new WebSocket('ws://localhost:' + port); ws.msgs = []; ws.last = null;
  ws.on('message', d => { const m = JSON.parse(d); ws.msgs.push(m); if (m.t === 's') ws.last = m; if (m.t === 'init') ws.id = m.id; }); ws.on('open', () => res(ws)); }); }
(async () => {
  // ---- regras de colisão (sala isolada, sem bots) ----
  const mk = () => { const r = new Room(false), sp = r.spawn.bind(r); r.spawn = (...a) => { const s = sp(...a); s.prot = 0; return s; }; return r; };
  let r = mk(), big = r.spawn('Grande', '🐲', false, null, null, 1000, 1000), sm = r.spawn('Pequeno', '🐸', false, null, null, 1000, 1000);
  big.m = 100; big.a = big.ta = 0; sm.m = 20; sm.a = sm.ta = 3.14;
  sm.segs = Array.from({ length: 12 }, (_, i) => ({ x: 1040 - i * 8, y: 1000 })); big.segs = Array.from({ length: 6 }, (_, i) => ({ x: 1000 - i * 10, y: 1000 }));
  const f0 = r.food.length; const m0 = big.m; r.step();
  eq('maior (>=1,5x) que encosta no corpo do menor come o menor', !sm.alive && big.alive && big.m > m0 + 9);
  eq('morte do menor gera comida coletável', r.food.length > f0);
  r = mk(); let b2 = r.spawn('Grande', '🐻', false, null, null, 1500, 1500), s2 = r.spawn('Pequeno', '🐱', false, null, null, 1470, 1500);
  b2.m = 100; s2.m = 20; b2.a = b2.ta = 0; s2.a = s2.ta = 0; b2.segs = Array.from({ length: 12 }, (_, i) => ({ x: 1520 - i * 10, y: 1500 }));
  s2.segs = Array.from({ length: 6 }, (_, i) => ({ x: 1530 - i * 6, y: 1500 })); // cabeça do pequeno dentro do corpo do grande
  r.step(); eq('menor que encosta no corpo do maior morre', !s2.alive && b2.alive);
  r = mk(); let e1 = r.spawn('A', '🐵', false, null, null, 800, 800), e2 = r.spawn('B', '🐧', false, null, null, 805, 800); e1.m = e2.m = 50; r.step();
  eq('cabeça x cabeça com massas parecidas: ninguém morre', e1.alive && e2.alive);
  r = mk(); let c = r.spawn('C', '🦊', false, null, null, 500, 500); r.food = [{ x: 505, y: 500, v: 3, c: 0 }]; const cm = c.m; r.step();
  eq('comida some e dá massa imediatamente', r.food.length > 0 ? !r.food.some(f => f.x === 505 && f.v === 3) && c.m >= cm + 3 : c.m >= cm + 3);
  r = mk(); let w = r.spawn('W', '🐢', false, null, null, 5, 5); w.ta = w.a = Math.PI; for (let i = 0; i < 40; i++) r.step();
  eq('borda do mapa não mata (apenas limita)', w.alive && w.segs[0].x >= 0 && w.segs[0].y >= 0);
  r = mk(); r.spawn('S', '🐙', false, null, null, 1500, 1500); const sp = r.sn.get(1), x0 = sp.segs[0].x, y0 = sp.segs[0].y; sp.a = sp.ta = 0; for (let i = 0; i < 20; i++) r.step();
  eq('velocidade do servidor é constante (170 px/s)', Math.abs(Math.hypot(sp.segs[0].x - x0, sp.segs[0].y - y0) - 170) < 6);
  { const r2 = new Room(false), bg = r2.spawn('G', '🐻', false, null, null, 1500, 1500), nv = r2.spawn('N', '🐱', false, null, null, 1470, 1500);
    bg.prot = 0; bg.m = 100; nv.m = 20; bg.a = bg.ta = 0; nv.a = nv.ta = 0;
    bg.segs = Array.from({ length: 12 }, (_, i) => ({ x: 1520 - i * 10, y: 1500 })); nv.segs = Array.from({ length: 6 }, (_, i) => ({ x: 1530 - i * 6, y: 1500 })); r2.step();
    eq('recém-nascido tem 3 s de proteção contra morte injusta', nv.alive); }
  // ---- bots ----
  r = new Room(true); r.fillBots(); for (let i = 0; i < 400; i++) { if (i % 40 === 0) r.fillBots(); r.step(); }
  const bots = [...r.sn.values()].filter(s => s.bot);
  eq('bots existem, são marcados como IA e se mantêm vivos/reposicionados', bots.length >= 4 && bots.every(b => b.n.startsWith('🤖')));
  eq('bots crescem comendo (algum passou de 10 de massa)', bots.some(b => b.m > 10));
  // ---- rede: dois clientes reais ----
  await new Promise(res => server.listen(0, res)); const port = server.address().port;
  const A = await client(port), B = await client(port);
  A.send(JSON.stringify({ t: 'join', nick: 'Alice', emoji: '🐱', tok: 'a'.repeat(40) })); B.send(JSON.stringify({ t: 'join', nick: 'Bruno', emoji: '🦊', tok: 'b'.repeat(40) }));
  await wait(900);
  eq('os dois clientes recebem init com ids diferentes', A.id && B.id && A.id !== B.id);
  eq('ambos recebem snapshots em tempo real', A.msgs.filter(m => m.t === 's').length > 8 && B.msgs.filter(m => m.t === 's').length > 8);
  const ids = new Set((A.last.mm || []).map(e => e[3])); eq('minimapa lista todos os participantes (incl. o outro humano)', ids.has(A.id) && ids.has(B.id));
  eq('bots chegam marcados com b=1', A.last.mm.some(e => e[4] === 1));
  eq('contagem online = 2 humanos', A.last.on === 2);
  const head = (cl, id) => { const o = cl.last.sn.find(o => o.i === id); return o && [o.s[0], o.s[1]]; };
  A.send(JSON.stringify({ t: 'in', a: 1 })); A.send(JSON.stringify({ t: 'in', a: 'hack' })); A.send(JSON.stringify({ t: 'in', a: null }));
  const R0 = require('./server').rooms[0], sa = R0.sn.get(A.id), sb = R0.sn.get(B.id); sb.segs.forEach((q, i) => { q.x = sa.segs[0].x + 300; q.y = sa.segs[0].y + 300 + i; });
  await wait(700); eq('A vê o emoji/apelido de B quando estão próximos', A.last.sn.some(o => o.i === B.id && o.n === 'Bruno' && o.e === '🦊'));
  const ang = rooms0(); function rooms0() { return require('./server').rooms[0].sn.get(A.id).ta; }
  eq('só ângulo numérico é aceito', ang === 1);
  const before = head(A, A.id); await wait(1000); const after = head(A, A.id);
  const dist = Math.hypot(after[0] - before[0], after[1] - before[1]); eq('deslocamento em 1s ≈ 170px (cliente não controla a velocidade)', dist < 200);
  const B2 = await client(port); B2.send(JSON.stringify({ t: 'join', nick: 'merda', emoji: 'X', tok: 'c'.repeat(40) })); await wait(300);
  eq('apelido ofensivo é trocado e emoji inválido vira padrão', B2.last && B2.last.sn.some(o => o.i === B2.id && o.n.startsWith('Jogador') && o.e === '🐱'));
  const closed = new Promise(res => B2.on('close', res)); for (let i = 0; i < 200; i++) B2.send(JSON.stringify({ t: 'in', a: 0 })); await Promise.race([closed, wait(1500)]);
  eq('flood de mensagens derruba a conexão', B2.readyState === WebSocket.CLOSED || B2.readyState === WebSocket.CLOSING);
  B.close(); await wait(400); if (process.env.DBG) console.log('DBG on=', A.last.on, 'hasB=', A.last.mm.some(e => e[3] === B.id), 'Aalive=', R0.sn.has(A.id), 'humans=', R0.humans(), 'age=', Date.now());
  eq('desconexão remove o jogador da partida', !A.last.mm.some(e => e[3] === B.id) && A.last.on === 1);
  const rr = await fetch('http://localhost:' + port + '/ranking').then(r => r.json()); eq('/ranking responde (desligado sem Supabase)', rr.off === true);
  console.log(`${ok}/${tot}`); process.exit(ok === tot ? 0 : 1);
})();
