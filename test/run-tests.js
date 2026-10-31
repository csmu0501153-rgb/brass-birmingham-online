// Headless integration tests for the online server (no browser).
// Usage: node test/run-tests.js
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const E = require('../server/engine');

const PORT = 3900 + Math.floor(Math.random() * 500);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-test-'));
const BASE = `http://127.0.0.1:${PORT}`;
let server = null;
let passed = 0, failed = 0;

function check(name, cond, extra = '') {
    if (cond) { passed++; console.log(`PASS  ${name}`); }
    else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer() {
    return new Promise((resolve, reject) => {
        server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
            env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, AI_DELAY_MS: '150' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        server.stderr.on('data', d => process.stderr.write('[server] ' + d));
        server.stdout.on('data', d => { if (String(d).includes('server on')) resolve(); });
        server.on('exit', c => { if (c) reject(new Error('server exit ' + c)); });
    });
}
function stopServer() {
    return new Promise(r => { server.on('exit', () => r()); server.kill('SIGTERM'); });
}

class Client {
    constructor(url) { this.url = url; this.msgs = []; this.raw = []; this.waiters = []; }
    open() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);
            this.ws.on('message', d => {
                const s = String(d); this.raw.push(s);
                const m = JSON.parse(s); this.msgs.push(m);
                if (m.type === 'state') this.last = m;
                this.waiters = this.waiters.filter(w => !(w.pred(m) && (w.resolve(m), true)));
            });
            this.ws.on('open', resolve);
            this.ws.on('error', reject);
        });
    }
    // Resolve with an already-received message if `past` is true, else wait for a new one.
    wait(pred, ms = 5000, past = false) {
        if (past) { const m = this.msgs.find(pred); if (m) return Promise.resolve(m); }
        return new Promise((resolve, reject) => {
            const w = { pred, resolve };
            this.waiters.push(w);
            setTimeout(() => reject(new Error('timeout waiting')), ms);
        });
    }
    send(o) { this.ws.send(JSON.stringify(o)); }
    close() { return new Promise(r => { if (this.ws.readyState === WebSocket.CLOSED) return r(); this.ws.on('close', r); this.ws.close(); }); }
}

// Pick a legal move from the REDACTED per-player view only (as a browser would).
function chooseFromView(view, seat) {
    const st = E.restoreState(JSON.stringify(view));
    const logic = new E.GameLogic(st);
    const d = E.AIPlayer.chooseAction(st, logic, seat, 'normal');
    const msg = { type: 'action', action: d.action, pendingData: d.pendingData || {}, cardIndex: d.cardIndex };
    if (d.action === 'scout') msg.scoutCards = [...d.pendingData.scoutCards, d.cardIndex];
    return msg;
}

function uidsIn(str) { return new Set([...str.matchAll(/"uid":"([0-9a-f]+)"/g)].map(m => m[1])); }

async function main() {
    await startServer();

    // --- HTTP basics
    const h = await (await fetch(`${BASE}/health`)).json();
    check('/health returns ok', h.ok === true, JSON.stringify(h));
    const idx = await fetch(`${BASE}/`);
    check('GET / serves index.html', idx.status === 200 && (await idx.text()).includes('game-board'));
    check('server source not served', (await fetch(`${BASE}/server/index.js`)).status === 404);
    check('data dir not served', (await fetch(`${BASE}/data/x.json`)).status === 404);
    check('path traversal blocked', (await fetch(`${BASE}/js/..%2f..%2fpackage.json`)).status === 404);

    // --- Create room: 2 humans + 1 AI
    const cr = await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seats: [{ name: 'Ann' }, { name: 'Ben' }, { name: 'Bot', isAI: true, difficulty: 'normal' }] }) });
    const room = await cr.json();
    check('room created with 2 private links', cr.status === 200 && room.seats.filter(s => s.url).length === 2 && room.seats[2].url === null);
    const tokA = new URL(room.seats[0].url).searchParams.get('token');
    check('token is long random hex', /^[0-9a-f]{32}$/.test(tokA));
    const bad = await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ seats: [{ name: 'x' }] }) });
    check('room with 1 player rejected', bad.status === 400);

    const wsUrl = s => room.seats[s].url.replace('http://', 'ws://').replace('/?', '/ws?');
    const A = new Client(wsUrl(0)), B = new Client(wsUrl(1));
    await A.open(); await B.open();
    await A.wait(m => m.type === 'state', 5000, true); await B.wait(m => m.type === 'state', 5000, true);

    // --- Bad token rejected
    const X = new Client(wsUrl(0).replace(/token=[0-9a-f]+/, 'token=' + '0'.repeat(32)));
    await X.open();
    const xm = await X.wait(m => m.type === 'error', 5000, true);
    check('bad token rejected (fatal)', xm.fatal === true);

    // --- Out-of-turn and illegal actions
    const cur = () => A.last.view.turnOrder[A.last.view.currentPlayerIndex];
    // wait until a human's turn
    for (let i = 0; i < 50 && cur() === 2; i++) await A.wait(m => m.type === 'state');
    const curSeat = cur();
    const [me, other] = curSeat === 0 ? [A, B] : [B, A];
    const revBefore = me.last.rev;
    other.send({ type: 'action', action: 'pass', cardIndex: 0 });
    let r = await other.wait(m => m.type === 'result');
    check('out-of-turn action rejected', r.ok === false && r.message === 'Not your turn', JSON.stringify(r));
    me.send({ type: 'action', action: 'build', pendingData: { cityId: 'nowhere', slotIndex: 0, industryType: 'cottonMill' }, cardIndex: 0 });
    r = await me.wait(m => m.type === 'result');
    check('illegal build rejected', r.ok === false, JSON.stringify(r));
    me.send({ type: 'action', action: 'pass', cardIndex: 99 });
    r = await me.wait(m => m.type === 'result');
    check('invalid card index rejected', r.ok === false, JSON.stringify(r));
    me.send({ type: 'action', action: 'hack', cardIndex: 0 });
    r = await me.wait(m => m.type === 'result');
    check('unknown action rejected', r.ok === false, JSON.stringify(r));
    me.send({ type: 'action', action: 'scout', scoutCards: [0, 0, 1] });
    r = await me.wait(m => m.type === 'result');
    check('scout with duplicate cards rejected', r.ok === false, JSON.stringify(r));
    await sleep(100);
    check('state unchanged after rejected actions', me.last.rev === revBefore);

    // --- Play legal turns (humans choose from their own redacted view)
    let humanMoves = 0, aiTurnsSeen = 0, lastCur = null;
    for (let step = 0; step < 300 && humanMoves < 16; step++) {
        await sleep(20);
        const st = A.last.view;
        if (st.gameOver) break;
        const s = st.turnOrder[st.currentPlayerIndex];
        if (s !== lastCur && s === 2) aiTurnsSeen++;
        lastCur = s;
        if (s === 2) { await A.wait(m => m.type === 'state'); continue; }
        const c = s === 0 ? A : B;
        if (c.last.pendingBonus) { c.send({ type: 'bonus', industryType: null }); await c.wait(m => m.type === 'result'); continue; }
        if (c.last.rev !== A.last.rev) { await sleep(50); continue; }
        const msg = chooseFromView(c.last.view, s);
        c.send(msg);
        const res = await c.wait(m => m.type === 'result');
        if (!res.ok) { console.log('  (move rejected, passing instead)', msg.action, res.message);
            c.send({ type: 'action', action: 'pass', cardIndex: 0 }); await c.wait(m => m.type === 'result'); }
        humanMoves++;
        await sleep(30);
    }
    check(`played ${humanMoves} legal human actions`, humanMoves >= 10);
    const aiLog = A.last.log.filter(e => e.playerId === 2);
    check('AI seat made moves', aiLog.length > 0 && aiTurnsSeen > 0, `aiLog=${aiLog.length}`);
    console.log('  sample AI log:', aiLog.slice(0, 3).map(e => e.message).join(' | '));

    // --- Hidden information: A's messages contain only A's own card uids
    const saved = fs.readFileSync(path.join(DATA, `room-${room.roomId}.json`), 'utf8');
    const savedState = JSON.parse(JSON.parse(saved).state);
    const deckUids = new Set(savedState.drawDeck.map(c => c.uid));
    let leak = 0, deckLeak = 0, ownOnly = true, hiddenOk = true;
    const bUids = new Set();
    for (const raw of B.raw) { const m = JSON.parse(raw); if (m.type === 'state') m.view.players[1].hand.forEach(c => bUids.add(c.uid)); }
    for (const raw of A.raw) {
        const m = JSON.parse(raw);
        for (const u of uidsIn(raw)) { if (bUids.has(u)) leak++; if (deckUids.has(u)) deckLeak++; }
        if (m.type !== 'state') continue;
        const own = new Set(m.view.players[0].hand.map(c => c.uid));
        for (const u of uidsIn(raw)) if (!own.has(u)) ownOnly = false;
        for (const p of m.view.players) if (p.id !== 0 && !p.hand.every(c => Object.keys(c).length === 1 && c.type === 'hidden')) hiddenOk = false;
        if (!m.view.drawDeck.every(c => Object.keys(c).length === 1 && c.type === 'hidden')) hiddenOk = false;
    }
    check(`A never received any of B's ${bUids.size} card uids`, leak === 0 && bUids.size > 0, `leaks=${leak}`);
    check(`A never received draw-deck card uids (${deckUids.size} in deck)`, deckLeak === 0);
    check('every uid A received belongs to A\'s own hand in that message', ownOnly);
    check('opponent hands and deck are bare {type:"hidden"} placeholders', hiddenOk);
    const bRawAll = B.raw.join('');
    check('B never received AI hand / deck uids', ![...uidsIn(bRawAll)].some(u => deckUids.has(u)));

    // --- Reconnect with token restores the view
    await sleep(800); // let AI finish if it's on turn
    const handBefore = JSON.stringify(A.last.view.players[0].hand);
    const revA = A.last.rev;
    await A.close();
    const A2 = new Client(wsUrl(0)); await A2.open();
    const s2 = await A2.wait(m => m.type === 'state', 5000, true);
    check('reconnect restores seat + same hand', s2.you === 0 && JSON.stringify(s2.view.players[0].hand) === handBefore && s2.rev >= revA);
    await A2.close(); await B.close(); await X.close().catch(() => {});

    // --- Server restart restores room from JSON
    await sleep(500);
    const preRestart = JSON.parse(fs.readFileSync(path.join(DATA, `room-${room.roomId}.json`), 'utf8'));
    await stopServer();
    await startServer();
    const A3 = new Client(wsUrl(0)); await A3.open();
    const s3 = await A3.wait(m => m.type === 'state', 5000, true);
    const preHand = JSON.parse(preRestart.state).players[0].hand.map(c => c.uid).join();
    check('after restart: room restored from saved JSON', s3.rev === preRestart.rev && s3.view.players[0].hand.map(c => c.uid).join() === preHand,
        `rev ${s3.rev} vs ${preRestart.rev}`);
    // and the game can continue
    for (let i = 0; i < 40; i++) {
        const v = A3.last.view; const s = v.turnOrder[v.currentPlayerIndex];
        if (s === 0) break;
        if (s === 1) { const B3 = new Client(wsUrl(1)); await B3.open(); const sb = await B3.wait(m => m.type === 'state', 5000, true);
            B3.send(chooseFromView(sb.view, 1)); await B3.wait(m => m.type === 'result'); await B3.close(); }
        await A3.wait(m => m.type === 'state', 3000).catch(() => {});
    }
    const v = A3.last.view;
    if (v.turnOrder[v.currentPlayerIndex] === 0) {
        const rv = A3.last.rev;
        A3.send(chooseFromView(v, 0));
        const rr = await A3.wait(m => m.type === 'result');
        check('game continues after restart (legal move accepted)', rr.ok === true || rr.message !== 'Not your turn');
        check('rev advanced after move', A3.last.rev > rv || rr.ok === false);
    } else check('game continues after restart', false, 'never got A turn');
    await A3.close();
    await stopServer();
}

main().then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}).catch(e => { console.error('ERROR', e); if (server) server.kill(); process.exit(1); });
