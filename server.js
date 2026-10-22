const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const server = http.createServer((q, s) => {
  if (q.url === '/healthz') { s.writeHead(200); return s.end('ok'); }
  s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(page);
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const rooms = new Map(), LET = 'ABCDEFGHJKLMNPQRSTUVWXYZ', MAXP = 6, MINP = 3;
const RN = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'], SU = ['♣','♦','♥','♠'];
const cn = id => RN[id >> 2] + SU[id & 3];
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => LET[crypto.randomInt(LET.length)]).join(''); } while (rooms.has(c)); return c; };
const lg = (r, s) => { r.log.unshift(s); r.log.length = Math.min(r.log.length, 30); };
const nm = (r, i) => r.players[i].name;
const title = (pos, n) => pos === 0 ? 'President' : pos === n - 1 ? 'Scum' : pos === 1 ? 'Vice-President' : pos === n - 2 ? 'Vice-Scum' : 'Neutral';

function view(r, me) {
  const n = r.players.length, g = r.H;
  return {
    t: 'state', code: r.code, me, host: r.host === r.players[me], phase: r.phase, round: r.round, turn: r.turn,
    players: r.players.map((p, i) => {
      const out = r.fin.indexOf(i);
      return { name: p.name, online: !!p.ws, count: g ? g[i].length : 0, out: out >= 0, title: out >= 0 ? title(out, n) : '', passed: !!r.passed[i] };
    }),
    hand: g ? g[me] : [], pile: r.pile,
    ranks: r.phase === 'over' ? r.fin.map((q, pos) => ({ name: nm(r, q), title: title(pos, n) })) : null,
    log: r.log.slice(0, 8)
  };
}
function broadcast(r) { r.last = Date.now(); r.players.forEach((p, i) => send(p.ws, view(r, i))); sched(r); }

function deal(r) {
  const n = r.players.length, d = [...Array(52).keys()];
  for (let i = 51; i > 0; i--) { const j = crypto.randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  r.H = Array.from({ length: n }, () => []); d.forEach((c, i) => r.H[i % n].push(c));
  const srt = () => r.H.forEach(h => h.sort((a, b) => a - b)); srt();
  r.phase = 'playing'; r.round++; r.pile = null; r.fin = []; r.passed = Array(n).fill(false); r.log = [];
  if (r.ranks && r.ranks.length === n) {
    const p = r.ranks[0], s = r.ranks[n - 1], best = r.H[s].pop(), worst = r.H[p].shift();
    r.H[p].push(best); r.H[s].push(worst); srt();
    lg(r, `${nm(r, s)} gave ${cn(best)} to ${nm(r, p)} and got ${cn(worst)} back`); r.turn = s;
  } else r.turn = r.H.findIndex(h => h.includes(0));
  lg(r, `${nm(r, r.turn)} leads`);
}
const nextUn = (r, p) => { const n = r.H.length; for (let i = 1; i <= n; i++) { const q = (p + i) % n; if (!r.fin.includes(q)) return q; } };
function clearTrick(r, by) { r.pile = null; r.passed = r.passed.map(() => false); r.turn = r.fin.includes(by) ? nextUn(r, by) : by; }
function advance(r, p) {
  const n = r.H.length;
  const c = [...Array(n).keys()].filter(q => !r.fin.includes(q) && !r.passed[q] && q !== r.pile.by);
  if (!c.length) { lg(r, `${nm(r, r.pile.by)} takes the pile`); clearTrick(r, r.pile.by); return; }
  for (let i = 1; i <= n; i++) { const q = (p + i) % n; if (c.includes(q)) { r.turn = q; return; } }
}
function doPlay(r, p, ids) {
  const rk = ids[0] >> 2, n = r.H.length;
  r.H[p] = r.H[p].filter(c => !ids.includes(c));
  r.pile = { r: rk, n: ids.length, by: p, cards: ids };
  lg(r, `${nm(r, p)} played ${ids.length > 1 ? ids.length + '× ' : ''}${RN[rk]}`);
  if (!r.H[p].length) { r.fin.push(p); lg(r, `${nm(r, p)} is out`); }
  if (r.fin.length >= n - 1) {
    const l = [...Array(n).keys()].find(q => !r.fin.includes(q));
    if (l !== undefined) r.fin.push(l);
    r.ranks = r.fin.slice(); r.phase = 'over'; return;
  }
  if (rk === 12) { lg(r, '2 clears the pile'); clearTrick(r, p); } else advance(r, p);
}
function doPass(r, p) { r.passed[p] = true; lg(r, `${nm(r, p)} passed`); advance(r, p); }

function autoplay(r) {
  const p = r.turn;
  if (r.pile) doPass(r, p);
  else { const h = r.H[p], lo = h[0] >> 2; doPlay(r, p, h.filter(id => id >> 2 === lo)); }
  broadcast(r);
}
function sched(r) {
  clearTimeout(r.timer);
  if (r.phase !== 'playing') return;
  if (!r.players[r.turn].ws) r.timer = setTimeout(() => {
    if (r.phase === 'playing' && !r.players[r.turn].ws) autoplay(r);
  }, 15000);
}
function fixHost(r) { if (!r.players.includes(r.host) || !r.host.ws) r.host = r.players.find(p => p.ws) || r.host; }
function cleanName(s, r) {
  let n = String(s || '').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Player', b = n, k = 2;
  while (r && r.players.some(p => p.name === n)) n = `${b} ${k++}`;
  return n;
}
function drop(ws) {
  const r = ws.room; if (!r) return; ws.room = null;
  const i = r.players.findIndex(p => p.ws === ws); if (i < 0) return;
  if (r.phase === 'lobby') r.players.splice(i, 1); else r.players[i].ws = null;
  if (!r.players.length) { clearTimeout(r.timer); rooms.delete(r.code); return; }
  fixHost(r); broadcast(r);
}

function handle(ws, m) {
  const err = msg => send(ws, { t: 'error', msg });
  if (m.t === 'ping') return;
  if (m.t === 'create') {
    if (rooms.size > 300) return err('Server busy, try again later');
    drop(ws);
    const r = { code: newCode(), players: [], host: null, phase: 'lobby', round: 0, H: null, pile: null, fin: [], passed: [], log: [], turn: 0, ranks: null, last: Date.now() };
    const p = { name: cleanName(m.name), token: crypto.randomUUID(), ws };
    r.players.push(p); r.host = p; rooms.set(r.code, r); ws.room = r;
    send(ws, { t: 'joined', code: r.code, token: p.token }); return broadcast(r);
  }
  if (m.t === 'join') {
    const r = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!r) return err('Room not found');
    let p = m.token && r.players.find(x => x.token === m.token);
    if (p) { if (p.ws && p.ws !== ws) { p.ws.room = null; p.ws.close(); } p.ws = ws; }
    else {
      if (r.phase !== 'lobby') return err('That game has already started');
      if (r.players.length >= MAXP) return err('Room is full');
      p = { name: cleanName(m.name, r), token: crypto.randomUUID(), ws }; r.players.push(p);
    }
    if (ws.room && ws.room !== r) drop(ws);
    ws.room = r; fixHost(r);
    send(ws, { t: 'joined', code: r.code, token: p.token }); return broadcast(r);
  }
  const r = ws.room; if (!r) return;
  const me = r.players.findIndex(p => p.ws === ws); if (me < 0) return;
  if (m.t === 'leave') { drop(ws); return send(ws, { t: 'left' }); }
  if (m.t === 'start') {
    if (r.host !== r.players[me] || r.phase !== 'lobby') return;
    if (r.players.length < MINP) return err(`Need at least ${MINP} players`);
    deal(r); return broadcast(r);
  }
  if (m.t === 'next') {
    if (r.host !== r.players[me] || r.phase !== 'over') return;
    deal(r); return broadcast(r);
  }
  if (r.phase !== 'playing' || r.turn !== me) return;
  if (m.t === 'pass') {
    if (!r.pile) return err('You have to lead');
    doPass(r, me); return broadcast(r);
  }
  if (m.t === 'play') {
    const ids = Array.isArray(m.ids) ? [...new Set(m.ids)].filter(Number.isInteger).sort((a, b) => a - b) : [];
    if (!ids.length || !ids.every(x => r.H[me].includes(x))) return err('Invalid cards');
    const rk = ids[0] >> 2;
    if (!ids.every(x => x >> 2 === rk)) return err('Cards must match in rank');
    if (r.pile && (ids.length !== r.pile.n || rk < r.pile.r)) return err('That does not beat the pile');
    doPlay(r, me, ids); return broadcast(r);
  }
}

wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch { return; } if (m && typeof m === 'object') handle(ws, m); });
  ws.on('close', () => drop(ws));
  ws.on('error', () => {});
});
setInterval(() => { wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }); }, 30000);
setInterval(() => {
  for (const [c, r] of rooms) if (!r.players.some(p => p.ws) && Date.now() - r.last > 600000) { clearTimeout(r.timer); rooms.delete(c); }
}, 60000);
server.listen(PORT, () => console.log('President server on :' + PORT));
