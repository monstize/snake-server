// EMOJI SNAKE — servidor autoritativo (WebSocket). O cliente só envia o ângulo desejado;
// posição, velocidade, comida, colisões, mortes e pontuação são decididos aqui.
const http = require('http'), crypto = require('crypto'), { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080, MAP = 3000, TICK = 50, CAP = 20, TARGET = 14, MAXF = 700, SPD = 170, TURN = 5, VR = 750;
const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const EMOJIS = ['🐱','🐸','🐼','🦊','🐵','🐲','👻','🤖','😈','🐙','🐧','🦄','🐢','🐻','🐍','🦖','🦈','🦁','👑','🔥','⚡','🍕','🚀','🐝'];
const BOTN = ['Zeca','Lia','Nuvem','Pixel','Tico','Bia','Rex','Luna','Dudu','Kiko','Mel','Thor'];
const BAD = ['porra','caralho','puta','merda','fdp','viado','buceta','cuzao','nazi','hitler','admin'];
const rnd = (a, b) => a + Math.random() * (b - a), rad = m => Math.min(48, 12 + Math.sqrt(m) * .8);
const clean = s => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14);
const okNick = s => { const n = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e').replace(/4/g,'a').replace(/5/g,'s').replace(/[...