// Optional jsdom smoke test of the client (no real browser, no rendering check).
// Requires jsdom: NODE_PATH=/path/to/node_modules node test/dom-smoke.js
'use strict';
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs'); const os = require('os');
const { JSDOM, VirtualConsole } = require('jsdom');
const PORT = 4500 + Math.floor(Math.random() * 400);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-dom-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${c ? '' : x}`); };

async function load(url, errors, lang) {
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message || e)).split('\n').slice(0, 3).join(' / ')));
    vc.on('error', e => errors.push('console.error: ' + e));
    const dom = await JSDOM.fromURL(url, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(w) {
            if (lang) w.localStorage.setItem('brass-lang', lang);
            // jsdom has no fetch; shim with Node's fetch (browsers have it natively)
            if (!w.fetch) w.fetch = (u, o) => fetch(new URL(u, w.location.href), o);
            // minimal 2D-context stub (jsdom has no canvas)
            const ctx2d = new Proxy({}, { get: (t, k) => k === 'createImageData' || k === 'getImageData'
                ? (a, b) => ({ width: a, height: b, data: new Uint8ClampedArray(Math.max(1, (a | 0) * (b | 0) * 4)) })
                : (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
            w.HTMLCanvasElement.prototype.getContext = () => ctx2d;
            w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
            w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
            w.SVGElement.prototype.getComputedTextLength = () => 10;
            if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        } });
    await new Promise(r => dom.window.addEventListener('load', r));
    return dom;
}

(async () => {
    const srv = spawn(process.execPath, ['server/index.js'], { cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, AI_DELAY_MS: '100' }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise(r => srv.stdout.on('data', d => String(d).includes('server on') && r()));
    try {
        // 1) Setup page in Chinese, create a room via the UI
        let errors = [];
        const setup = await load(`http://127.0.0.1:${PORT}/`, errors);
        const d = setup.window.document;
        await sleep(200);
        check('setup page: Chinese title "建立房間" button', d.getElementById('start-game-btn').textContent.includes('建立房間'),
            d.getElementById('start-game-btn').textContent);
        d.querySelector('.count-btn[data-count="3"]').click();
        const sels = d.querySelectorAll('.seat-kind-select');
        sels[2].value = 'easy';
        d.getElementById('start-game-btn').click();
        for (let i = 0; i < 40 && d.getElementById('room-links').classList.contains('hidden'); i++) await sleep(100);
        const urls = [...d.querySelectorAll('.room-link-url')].map(i => i.value);
        check('room links panel shows 2 human links', urls.length === 2 && urls.every(u => /room=.*&token=[0-9a-f]{32}/.test(u)), JSON.stringify(urls));
        check('note about not sharing links (Chinese) shown', d.getElementById('room-links').textContent.includes('不要把連結分享給其他人'));
        check('no JS errors on setup page', errors.length === 0, errors.join('\n'));
        setup.window.close();

        // 2) Game page for seat 0
        errors = [];
        const g = await load(urls[0], errors);
        const gd = g.window.document;
        for (let i = 0; i < 50 && !g.window.uiManager; i++) await sleep(100);
        await sleep(500);
        check('game page connected and UIManager created', !!g.window.uiManager, errors.join('\n'));
        const um = g.window.uiManager;
        check('hand shows MY 8 cards', gd.querySelectorAll('#player-hand .card').length === 8, gd.querySelectorAll('#player-hand .card').length);
        check('net status online (中文)', gd.getElementById('net-status').textContent === '已連線', gd.getElementById('net-status').textContent);
        check('game log rendered', gd.querySelectorAll('#game-log .log-entry').length > 0);
        check('UI text translated (你的手牌 / 建造)', gd.body.textContent.includes('你的手牌') && gd.body.textContent.includes('建造'));
        check('board SVG rendered some elements', gd.querySelectorAll('#game-board *').length > 50, gd.querySelectorAll('#game-board *').length);
        // Wait until it's my turn, then do a Pass via clicks: action button -> card
        for (let i = 0; i < 60 && !um.isMyTurn(); i++) {
            if (!um.isMyTurn() && um.state.currentPlayerId === 1) break; // seat 1 has no client here
            await sleep(200);
        }
        if (um.isMyTurn()) {
            const rev = um.state.round + ':' + um.state.actionsThisTurn + ':' + um.state.currentPlayerIndex;
            gd.querySelector('.action-btn[data-action="pass"]').click();
            await sleep(50);
            gd.querySelector('#player-hand .card').click();
            await sleep(800);
            const rev2 = um.state.round + ':' + um.state.actionsThisTurn + ':' + um.state.currentPlayerIndex;
            check('Pass via UI clicks was accepted by server (state advanced)', rev !== rev2, rev + ' -> ' + rev2);
            check('hand now shows 7 cards (one discarded, not yet redrawn) or turn passed', gd.querySelectorAll('#player-hand .card').length >= 7);
        } else {
            console.log('SKIP  click-through (seat 0 not on turn: seat ' + um.state.currentPlayerId + ' starts)');
        }
        const opp = um.state.players.find(p => p.id !== 0);
        check('client state has opponents\' hands only as hidden placeholders', opp.hand.every(c => c.type === 'hidden'));
        check('lang toggle lives in the top bar (no overlap with log)', !!gd.querySelector('#top-bar .lang-toggle'));
        check('player panels show 行動中 / 等待中 labels', gd.getElementById('player-panels').textContent.includes('等待中') && gd.getElementById('player-panels').textContent.includes('行動中'));
        check('board zoom buttons present', gd.querySelectorAll('.board-zoom button').length === 3);
        um.selectedAction = 'build'; um.actionStep = 0; um.updatePhaseBar(); await sleep(50);
        const lbls = () => [...gd.querySelectorAll('.phase-step')].filter(x => !x.classList.contains('hidden')).map(x => x.querySelector('.phase-step-label').textContent).join('>');
        check('build step bar: 選擇行動>選擇工業與地點>棄一張牌', lbls() === '選擇行動>選擇工業與地點>棄一張牌', lbls());
        um.selectedAction = 'loan'; um.actionStep = 1; um.updatePhaseBar(); await sleep(50);
        check('loan step bar has no 選擇目標 step', lbls() === '選擇行動>棄一張牌', lbls());
        um.selectedAction = null; um.actionStep = 0; um.updatePhaseBar();
        const probe = gd.createElement('div'); probe.textContent = 'Built Coal Mine Level 1 in Coventry'; gd.getElementById('game-log').appendChild(probe);
        await sleep(50);
        check('town names shown as 考文垂 Coventry in HTML text', probe.textContent.includes('考文垂 Coventry'), probe.textContent);
        probe.remove();
        check('no JS errors on game page', errors.length === 0, '\n  ' + errors.join('\n  '));

        // 2b) Invalid token -> only the error page
        errors = [];
        const bad = await load(urls[0].replace(/token=[0-9a-f]+/, 'token=' + '0'.repeat(32)), errors);
        await sleep(800);
        const bd = bad.window.document;
        check('invalid token: error page shown', !bd.getElementById('fatal-error').classList.contains('hidden') && bd.getElementById('fatal-error').textContent.includes('無法加入遊戲'));
        check('invalid token: game scaffold hidden', !bd.getElementById('game-screen').classList.contains('active') && bd.body.classList.contains('fatal-only'));
        bad.window.close();

        // 3) English toggle
        errors = [];
        const e2 = await load(`http://127.0.0.1:${PORT}/`, errors, 'en');
        await sleep(200);
        check('English mode (localStorage brass-lang=en) shows English UI', e2.window.document.getElementById('start-game-btn').textContent.includes('Create Room') && e2.window.document.querySelector('.lang-toggle').textContent === '中文');
        e2.window.close(); g.window.close();
    } catch (err) { console.log('ERROR', err); fail++; }
    srv.kill('SIGTERM');
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
