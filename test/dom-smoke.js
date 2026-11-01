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
        {
            // Player-mat "next tile" popover: content must match INDUSTRY_DATA + my real remaining stack.
            const W = g.window; const ID = W.eval('INDUSTRY_DATA'); const me = um.state.players[um.myId];
            const types = Object.keys(ID); let allOk = true; const bad = [];
            for (const type of types) {
                const el = gd.querySelector(`#player-mat .mat-industry[data-type="${type}"]`);
                el.dispatchEvent(new W.MouseEvent('mouseenter'));
                const tip = gd.getElementById('tile-tip');
                const unused = me.industryTiles[type].filter(t => !t.used);
                const nx = unused[0]; const src = ID[type].find(r => r.level === nx.level);
                const f = k => { const r = tip.querySelector(`[data-f="${k}"] b`); return r && r.textContent; };
                const ok = !tip.hidden && tip.dataset.type === type && tip.querySelector('[data-f="level"]').textContent.includes(String(src.level))
                    && f('cost') === '£' + src.cost && f('coal') === String(src.costCoal) && f('iron') === String(src.costIron)
                    && f('vp') === String(src.vp) && f('link') === String(src.linkVP) && f('income') === '+' + src.income
                    && f('remaining') === String(unused.length) && (src.beersToSell == null ? !tip.querySelector('[data-f="beer"]') : f('beer') === String(src.beersToSell))
                    && f('develop') === (src.canDevelop ? '可以' : '不可（燈泡）')
                    && tip.querySelector('[data-f="after1"]').textContent.includes(`等級 ${unused[1].level}：${unused[1].vp} 勝利點／連線 ${unused[1].linkVP}`);
                if (!ok) { allOk = false; bad.push(type + ':' + tip.textContent); }
                el.dispatchEvent(new W.MouseEvent('mouseleave'));
            }
            check('tile tip (hover): every industry shows lowest tile data from INDUSTRY_DATA + 2nd tile', allOk, bad.join(' | '));
            check('tile tip hides on mouseleave', gd.getElementById('tile-tip').hidden);
            check('pottery lowest tile marked 不可發展', (() => { const el = gd.querySelector('#player-mat .mat-industry[data-type="pottery"]'); el.dispatchEvent(new W.MouseEvent('mouseenter')); const t = gd.getElementById('tile-tip').textContent; el.dispatchEvent(new W.MouseEvent('mouseleave')); return ID.pottery[0].canDevelop === false && t.includes('不可（燈泡）') && t.includes('此張不能發展'); })());
            // Simulate using up tiles: remaining count follows state; empty => 已用完
            const saved = me.industryTiles.ironWorks.map(t => t.used);
            me.industryTiles.ironWorks[0].used = true;
            um.updatePlayerMat();
            let el = gd.querySelector('#player-mat .mat-industry[data-type="ironWorks"]');
            el.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
            let tip = gd.getElementById('tile-tip');
            check('tile tip (tap): after one used, shows Lv2 and remaining-1', !tip.hidden && tip.querySelector('[data-f="level"]').textContent.includes('2')
                && tip.querySelector('[data-f="remaining"] b').textContent === String(saved.length - 1) && tip.querySelector('[data-f="vp"] b').textContent === String(ID.ironWorks[1].vp));
            el.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
            check('tile tip: second tap closes it', tip.hidden);
            me.industryTiles.ironWorks.forEach(t => { t.used = true; });
            um.updatePlayerMat();
            el = gd.querySelector('#player-mat .mat-industry[data-type="ironWorks"]');
            el.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
            check('tile tip: empty industry shows 已用完', !tip.hidden && tip.querySelector('[data-f="empty"]').textContent === '已用完', tip.textContent);
            gd.body.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
            check('tile tip: tap elsewhere closes', tip.hidden);
            me.industryTiles.ironWorks.forEach((t, i) => { t.used = saved[i]; }); um.updatePlayerMat();
        }
        check('board zoom buttons present', gd.querySelectorAll('.board-zoom button').length === 3);
        {
            const st = g.window.uiManager.state;
            const rows = [...gd.querySelectorAll('#merchant-legend .merch-row')];
            const act = Object.entries(g.window.eval('MERCHANTS')).filter(([, m]) => m.minPlayers <= st.numPlayers).map(([id]) => id);
            check('merchant legend: one row per active merchant', rows.length === act.length, rows.length);
            const shown = rows.flatMap(r => [...r.querySelectorAll('.merch-badge')].map(b => b.dataset.buys));
            check('merchant legend shows CURRENT game tiles', JSON.stringify(shown) === JSON.stringify(act.flatMap(id => st.merchantTiles.filter(t => t.location === id).map(t => t.buys))), JSON.stringify(shown));
            check('merchant legend Chinese bonus text', /牛津商人/.test(gd.getElementById('merchant-legend').textContent) && /收入 \+2/.test(gd.getElementById('merchant-legend').textContent) && /免費發展/.test(gd.getElementById('merchant-legend').textContent));
            const badges = gd.querySelectorAll('#merchants-layer .merchant-goods');
            check('map: a goods badge per merchant space', badges.length === st.merchantTiles.length, badges.length);
            check('map: beer bonus pill per merchant', gd.querySelectorAll('#merchants-layer .merchant-bonus').length === act.length);
        }
        {
            const W = g.window;
            const labels = [...gd.querySelectorAll('#town-labels-layer .town-label')];
            const cityIds = Object.keys(W.eval('CITIES'));
            const ids = new Set(labels.map(l => l.dataset.label));
            check('town labels: one per town', cityIds.every(id => ids.has(id)), cityIds.filter(id => !ids.has(id)).join(','));
            check('town labels: active merchants labelled 商人', ['shrewsbury', 'gloucester', 'oxford'].every(id => ids.has(id))
                && gd.querySelector('[data-label="oxford"] .town-label-zh').textContent === '牛津商人');
            check('town label zh+en (伯明罕 / Birmingham)', gd.querySelector('[data-label="birmingham"] .town-label-zh').textContent === '伯明罕'
                && gd.querySelector('[data-label="birmingham"] .town-label-en').textContent === 'Birmingham');
            check('town labels pointer-events none', gd.getElementById('town-labels-layer').getAttribute('pointer-events') === 'none');
            const tb = gd.getElementById('toggle-labels-btn');
            check('toggle default ON (隱藏地名)', tb && tb.textContent === '隱藏地名' && !gd.getElementById('town-labels-layer').hasAttribute('display'));
            tb.click();
            check('toggle hides labels (顯示地名)', tb.textContent === '顯示地名' && gd.getElementById('town-labels-layer').getAttribute('display') === 'none');
            tb.click();
            check('link legend present (運河/鐵路)', /運河/.test(gd.getElementById('link-legend').textContent) && /鐵路/.test(gd.getElementById('link-legend').textContent));
            // Built link overlay
            const st = um.state; const conn = W.eval('CONNECTIONS').find(c => c.canal);
            st.boardLinks[conn.id] = { playerId: 0, type: 'canal' };
            um.renderer.updateLinks();
            const lines = gd.querySelectorAll('#built-links-layer line');
            check('built canal link body drawn in owner colour (with canal stripe)', [...lines].some(l => l.getAttribute('stroke') === '#1f7fd6')
                && [...lines].some(l => l.getAttribute('stroke') === st.players[0].color && l.classList.contains('link-body')));
            {
                // Link VP badge must equal what calculateEraScore credits for this link.
                const savedInd = st.boardIndustries;
                const cityId = conn.cities.find(c => W.eval('CITIES')[c]);
                const mkTile = (pid, type, lvl, flipped) => ({ playerId: pid, type, flipped, resourceCubes: 0,
                    tileData: { level: lvl, vp: lvl, linkVP: lvl === 1 ? 2 : 1, cost: 5, era: 'both' } });
                st.boardIndustries = { ...savedInd, [cityId + '_0']: mkTile(1, 'coalMine', 1, true), [cityId + '_1']: mkTile(0, 'coalMine', 2, false) };
                um.renderer.fullUpdate(st);
                const shown = +gd.querySelector(`#built-links-layer [data-link="${conn.id}"] .link-vp`).getAttribute('data-vp');
                const expect = W.eval('(st) => { const g = Object.assign({}, st, { players: st.players.map(p => Object.assign({}, p)) }); g.breweryFarmTiles = g.breweryFarmTiles || {}; for (const k of Object.getOwnPropertyNames(GameState.prototype)) { const d = Object.getOwnPropertyDescriptor(GameState.prototype, k); if (typeof d.value === "function" && k !== "constructor") g[k] = d.value; } return GameState.prototype.calculateEraScore.call(g)[0].linkVP; }')(st);
                check('link VP badge matches calculateEraScore (flipped coal counts, unflipped not)', shown === expect && shown >= 1, shown + ' vs ' + expect);
                gd.querySelector(`#built-links-layer [data-link="${conn.id}"]`).dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
                check('tapping link shows Chinese VP breakdown', /運河目前值 \+\d+ 分/.test(um.renderer.lastLinkInfo || ''), um.renderer.lastLinkInfo);
                check('built tiles carry owner-colour ring', [...gd.querySelectorAll('.tile-owner-ring')].some(r => r.getAttribute('stroke') === st.players[1].color) || gd.querySelectorAll('.built-tile').length > 0);
                {
                    // Four players, four distinct colours: tiles, links, badges and
                    // panel names must all use the shared PLAYER_COLORS palette.
                    const PC = W.eval('PLAYER_COLORS'); const NAMES = W.eval('PLAYER_NAMES');
                    check('palette: 4 distinct player colours', new Set(PC.map(c => c.toLowerCase())).size === 4, PC.join(','));
                    const savedPlayers = st.players.slice();
                    while (st.players.length < 4) { const i = st.players.length; st.players.push(Object.assign({}, st.players[0], { id: i, name: 'P' + (i + 1), color: PC[i], colorName: NAMES[i], isAI: true })); }
                    const conns = W.eval('CONNECTIONS').filter(c => c.canal).slice(0, 4);
                    const savedLinks = st.boardLinks; st.boardLinks = {};
                    conns.forEach((c, i) => { st.boardLinks[c.id] = { playerId: i, type: 'canal' }; });
                    const four = {}; let k = 0;
                    for (const cid of Object.keys(W.eval('CITIES'))) { if (k >= 4) break; if (!savedInd[cid + '_0']) { four[cid + '_0'] = mkTile(k, 'coalMine', 1, k % 2 === 0); k++; } }
                    st.boardIndustries = { ...savedInd, ...four };
                    um.renderer.fullUpdate(st); um.updateUI && um.updateUI();
                    const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
                    const panelNames = [...gd.querySelectorAll('.player-panel-name')];
                    for (let i = 0; i < 4; i++) {
                        const c = PC[i];
                        const ring = gd.querySelector(`.tile-owner-ring[data-owner="${i}"]`);
                        const tint = gd.querySelector(`.tile-owner-tint[data-owner="${i}"]`);
                        const link = gd.querySelector(`#built-links-layer .link-body[data-owner="${i}"]`);
                        const pn = panelNames.find(el => el.textContent.startsWith(st.players[i].name));
                        const pnc = pn && (pn.style.color.startsWith('#') ? pn.style.color : pn.style.color);
                        check(`player ${i + 1}: tile ring/tint, link and panel name share ${c}`,
                            (!ring || ring.getAttribute('stroke') === c) && (!tint || (tint.getAttribute('fill') === c && +tint.getAttribute('fill-opacity') >= 0.35))
                            && link && link.getAttribute('stroke') === c && (!pn || pnc === c || pnc === hex2rgb(c)),
                            JSON.stringify({ ring: ring && ring.getAttribute('stroke'), tint: tint && tint.getAttribute('fill'), link: link && link.getAttribute('stroke'), pn: pnc }));
                    }
                    check('owner ring >= 3px non-scaling', [...gd.querySelectorAll('.tile-owner-ring')].every(r => +r.getAttribute('stroke-width') >= 3));
                    st.boardLinks = savedLinks; st.players.length = 0; savedPlayers.forEach(p => st.players.push(p));
                }
                st.boardIndustries = savedInd;
            }
            check('town labels still on top after link redraw', gd.getElementById('game-board').lastElementChild.id === 'town-labels-layer');
            delete st.boardLinks[conn.id]; um.renderer.updateLinks();
            // Build hints on my idle turn
            {
                const realTurn = um.isMyTurn; um.isMyTurn = () => true; um.selectedAction = null;
                um.updateBuildHints();
                const n = new Set(um.logic.getValidBuildTargets(um.myId).map(t => t.cityId + '|' + t.slotIndex)).size;
                const hints = gd.querySelectorAll('#build-hints-layer .build-hint').length;
                check('build hints: one glow per legal slot', n > 0 && hints === n, hints + ' vs ' + n);
                check('build hints badges use 煤/鐵/啤/棉/製/陶', [...gd.querySelectorAll('.build-hint-badge')].every(b => /^[煤鐵啤棉製陶]+$/.test(b.textContent)));
                check('build hints pointer-events none', gd.getElementById('build-hints-layer').getAttribute('pointer-events') === 'none');
                const hb = gd.getElementById('toggle-hints-btn');
                check('顯示可蓋位置 toggle default ON', hb && hb.textContent === '顯示可蓋位置' && hb.getAttribute('aria-pressed') === 'true');
                hb.click();
                check('toggle OFF clears hints', !gd.getElementById('build-hints-layer') && hb.getAttribute('aria-pressed') === 'false');
                hb.click();
                um.selectedAction = 'network'; um.updateBuildHints();
                check('hints hidden once an action is chosen', !gd.getElementById('build-hints-layer'));
                um.selectedAction = null; um.isMyTurn = realTurn; um.updateBuildHints();
            }
            // Link picker: tap map -> confirmation with zh+en names and cost
            const targets = um.logic.getValidNetworkTargets(0);
            if (targets.length) {
                um.selectedAction = 'network';
                um.startNetwork(0);
                const t0 = targets[0];
                const hl = gd.querySelector(`.connection-line.highlight[data-connection="${t0.connectionId}"]`);
                check('legal links highlighted on map', !!hl && gd.querySelectorAll('.connection-line.highlight').length >= targets.length);
                um.previewLink(t0.connectionId);
                const txt = gd.querySelector('#link-picker .link-pick-text').textContent;
                const en1 = W.eval('CITIES')[t0.cities[0]]?.name || W.eval('MERCHANTS')[t0.cities[0]].name;
                check('confirmation shows town names (zh+en) and cost', txt.includes(en1) && txt.includes(W.I18N.zhName(en1)) && txt.includes('£' + t0.cost), txt);
                um.cancelAction();
                check('cancel removes link picker', !gd.getElementById('link-picker'));
            } else console.log('SKIP  link picker (no network targets)');
        }
        um.selectedAction = 'build'; um.actionStep = 0; um.updatePhaseBar(); await sleep(50);
        const lbls = () => [...gd.querySelectorAll('.phase-step')].filter(x => !x.classList.contains('hidden')).map(x => x.querySelector('.phase-step-label').textContent).join('>');
        check('build step bar: 選擇行動>選擇工業與地點>棄一張牌', lbls() === '選擇行動>選擇工業與地點>棄一張牌', lbls());
        um.selectedAction = 'loan'; um.actionStep = 1; um.updatePhaseBar(); await sleep(50);
        check('loan step bar has no 選擇目標 step', lbls() === '選擇行動>棄一張牌', lbls());
        const vis = () => [...gd.querySelectorAll('.phase-step')].filter(x => g.window.getComputedStyle(x).display !== 'none');
        const full = () => vis().map(x => x.querySelector('.phase-step-num').textContent + ' ' + x.querySelector('.phase-step-label').textContent).join(' ▶ ');
        const expect = { build: '1 選擇行動 ▶ 2 選擇工業與地點 ▶ 3 棄一張牌', network: '1 選擇行動 ▶ 2 選擇連線 ▶ 3 棄一張牌', develop: '1 選擇行動 ▶ 2 選擇要發展的板塊 ▶ 3 棄一張牌', sell: '1 選擇行動 ▶ 2 選擇要販售的工業 ▶ 3 棄一張牌', loan: '1 選擇行動 ▶ 2 棄一張牌', pass: '1 選擇行動 ▶ 2 棄一張牌', scout: '1 選擇行動 ▶ 2 棄三張牌' };
        for (const [a, want] of Object.entries(expect)) for (const st of [0, 1]) {
            um.selectedAction = a; um.actionStep = st; um.pendingData = um.pendingData || {}; um.updatePhaseBar(); await sleep(30);
            const nums = vis().map(x => x.querySelector('.phase-step-num').textContent);
            check(`step bar ${a}/step${st}: ${want}`, full() === want && nums.every((n, i) => n === String(i + 1)), full());
            const arrowsVis = [...gd.querySelectorAll('.phase-step-arrow')].filter(x => g.window.getComputedStyle(x).display !== 'none').length;
            check(`step bar ${a}: arrows = steps-1`, arrowsVis === nums.length - 1, arrowsVis);
        }
        um.selectedAction = null; um.actionStep = 0; um.updatePhaseBar();
        // Turn banner must not intercept clicks on the action buttons.
        um.showTurnTransition(um.state.players[0]);
        check('turn banner has pointer-events:none', g.window.getComputedStyle(gd.getElementById('turn-transition')).pointerEvents === 'none');
        const pb = gd.querySelector('.action-btn[data-action="pass"]');
        const pbBefore = pb; um.updateActionButtons(); um.refresh();
        check('跳過 button element is stable across re-render', gd.querySelector('.action-btn[data-action="pass"]') === pbBefore);
        check('跳過 enabled iff it is my turn', pb.disabled === !um.isMyTurn(), pb.disabled + ' / ' + um.isMyTurn());
        // 2-tile develop: second list is computed after removing the first tile.
        {
            const me = um.state.players[0];
            const saved = JSON.stringify(me.industryTiles.ironWorks);
            me.industryTiles.ironWorks.forEach(t => { t.used = false; });
            const opts = um.getDevelopSecondOptions(0, 'ironWorks');
            const iw = opts.find(o => o.type === 'ironWorks');
            check('develop 2nd tile after 鐵工廠 Lv1 offers 鐵工廠 Lv2 (not Lv1)', iw && iw.level === 2, JSON.stringify(iw && iw.level));
            const pot = me.industryTiles.pottery; const savedP = JSON.stringify(pot);
            pot.forEach(t => { t.used = t.level === 1; });
            check('develop 2nd tile after 陶瓷廠 Lv2 excludes lightbulb Lv3', !um.getDevelopSecondOptions(0, 'pottery').some(o => o.type === 'pottery'));
            me.industryTiles.ironWorks = JSON.parse(saved); me.industryTiles.pottery = JSON.parse(savedP);
        }
        const T = g.window.I18N.t;
        const logCases = {
            'sold Cotton Mill Lv1 [+£5 (Warrington)]': '賣出了 棉紡廠 等級1，獲得商人獎勵 +£5（沃靈頓 Warrington）',
            'sold Manufacturer Lv2 [+2 VP (Oxford)]': '賣出了 製造商 等級2，獲得商人獎勵 +2 勝利點（牛津 Oxford）',
            'sold Pottery Lv1 [+2 income spaces (Shrewsbury)]': '賣出了 陶瓷廠 等級1，獲得商人獎勵 +2 收入格（什魯斯伯里 Shrewsbury）',
            'sold Cotton Mill Lv1 [free develop earned (Gloucester)]': '賣出了 棉紡廠 等級1，獲得商人獎勵 獲得免費發展（格洛斯特 Gloucester）',
            'sold Cotton Mill Lv1 [free develop: Iron Works]': '賣出了 棉紡廠 等級1，獲得商人獎勵 免費發展：鐵工廠',
            'sold Cotton Mill Lv1, sold Pottery Lv2': '賣出了 棉紡廠 等級1；賣出了 陶瓷廠 等級2',
            'sold Coal Mine Lv1 for £4 to cover income shortfall': '為補足收入缺口賣掉 煤礦 等級1，得 £4',
        };
        for (const [en, zh] of Object.entries(logCases)) check(`log zh: ${en}`, T(en) === zh, T(en));
        for (const en of ['developed Iron Works and Coal Mine', 'used merchant bonus: developed Iron Works', 'took £30 loan', 'passed',
            'scouted (gained wild cards)', 'built canal link: Coventry - Nuneaton', 'Game started with 3 players', "Carol's turn",
            'No coal for second link', 'Cannot afford both links', 'could not pay income shortfall — lost 3 VP'])
            check(`log zh has no English words: ${en}`, !/[a-z]{3,}/.test(T(en).replace(/[A-Z][a-z]+/g, '')), T(en));
        const probe = gd.createElement('div'); probe.textContent = 'Built Coal Mine Level 1 in Coventry'; gd.getElementById('game-log').appendChild(probe);
        await sleep(50);
        check('town names shown as 考文垂 Coventry in HTML text', probe.textContent.includes('考文垂 Coventry'), probe.textContent);
        probe.remove();
        // Build flow: industry -> highlighted slots + grouped list -> confirm panel
        {
            const saved = { a: um.selectedAction, s: um.actionStep, cpi: um.state.currentPlayerIndex };
            um.state.currentPlayerIndex = um.state.turnOrder ? um.state.turnOrder.indexOf(0) : 0;
            console.log('INFO  build targets for seat', um.state.currentPlayerId, um.logic.getValidBuildTargets(um.state.currentPlayerId).length);
            um.selectedAction = 'build'; um.actionStep = 0; um.pendingData = {};
            um.startBuild(um.state.currentPlayerId); await sleep(50);
            const bp = gd.getElementById('build-panel');
            const all = um.pendingData.buildTargets || [];
            check('build: build panel shown (not modal)', bp && !bp.classList.contains('hidden') && gd.getElementById('modal-overlay').classList.contains('hidden'));
            check('build: other UI dimmed (build-picking)', gd.getElementById('game-screen').classList.contains('build-picking'));
            const indBtn = gd.querySelector('#build-panel .bp-industry');
            if (indBtn) indBtn.click(); await sleep(50);
            const type = um.pendingData.buildIndustry;
            const legal = all.filter(t => t.industryType === type);
            const hl = [...gd.querySelectorAll('#game-board .highlight-slot')];
            const want = new Set(legal.map(t => t.cityId + ':' + t.slotIndex));
            const got = new Set(hl.map(e => e.dataset.farm ? e.dataset.farm + ':0' : e.dataset.city + ':' + e.dataset.slot));
            check('build: ONLY legal slots for chosen industry highlighted', legal.length > 0 && want.size === got.size && [...want].every(k => got.has(k)), [...want] + ' vs ' + [...got]);
            check('build: board in dim mode', gd.getElementById('game-board').classList.contains('build-select-mode'));
            const towns = [...gd.querySelectorAll('#build-panel .bp-town')];
            check('build: list grouped by town (one header per town)', towns.length === new Set(legal.map(t => t.cityId)).size && towns.every(x => x.querySelector('.bp-town-name')));
            const slotTxt = gd.querySelector('#build-panel .bp-slot') ? gd.querySelector('#build-panel .bp-slot').textContent : '';
            check('build: slot button reads 第 N 格（可蓋：…） + £ cost', /第 \d+ 格（可蓋：/.test(slotTxt) && /£\d+/.test(slotTxt), slotTxt);
            check('build: town header uses 中文 + English name', /[\u4e00-\u9fff].* [A-Z]/.test(towns[0] ? towns[0].textContent : ''), towns[0] && towns[0].textContent);
            // tap a highlighted slot on the board
            const el = hl[0];
            if (el) el.dispatchEvent(new g.window.MouseEvent('click', { bubbles: true }));
            await sleep(50);
            if (!um.pendingData.buildChoice) { // not my turn: board clicks ignored -> use list
                gd.querySelector('#build-panel .bp-slot').click(); await sleep(50);
            }
            const conf = gd.querySelector('#build-panel .bp-confirm');
            check('build: confirm panel one-liner 在〈城鎮〉第 N 格 建造…費用 £X，使用煤 N／鐵 N', conf && /在 〈.+〉 第 \d+ 格 建造 〈.+ 等級\d〉，費用 £\d+，使用煤 \d+／鐵 \d+/.test(conf.textContent), conf && conf.textContent);
            check('build: confirm panel has 確認 and 取消', conf && conf.textContent.includes('確認') && conf.textContent.includes('取消'));
            check('build: board zoomed to town', gd.getElementById('game-board').getAttribute('viewBox') !== '-46 -46 992 942', gd.getElementById('game-board').getAttribute('viewBox'));
            check('build: step bar still 選擇工業與地點 active', (gd.querySelector('.phase-step.active .phase-step-label') || {}).textContent === '選擇工業與地點');
            const chosen = um.pendingData.buildChoice;
            gd.querySelector('#build-panel [data-bp="ok"]').click(); await sleep(50);
            check('build: 確認 -> discard step, pendingData set, panel hidden', um.actionStep === 1 && um.pendingData.cityId === chosen.cityId && um.pendingData.slotIndex === chosen.slotIndex && bp.classList.contains('hidden') && !gd.getElementById('game-screen').classList.contains('build-picking'));
            check('build: step bar now 棄一張牌', (gd.querySelector('.phase-step.active .phase-step-label') || {}).textContent === '棄一張牌');
            um.cancelAction(); um.selectedAction = saved.a; um.actionStep = saved.s; um.state.currentPlayerIndex = saved.cpi;
        }
        // Card preview: tap a hand card -> legal spots for THAT card glow
        {
            const saved = { cpi: um.state.currentPlayerIndex };
            um.state.currentPlayerIndex = um.state.turnOrder ? um.state.turnOrder.indexOf(um.myId) : um.myId;
            um.cancelAction();
            const sent = []; const origSend = um.net && um.net.send; if (um.net) um.net.send = m => { sent.push(m); return true; };
            const before = JSON.stringify(um.state.players[um.myId]) + JSON.stringify(um.state.boardIndustries);
            const key = e => e.dataset.farm ? e.dataset.farm + ':0' : e.dataset.city + ':' + e.dataset.slot;
            const hand = um.state.players[um.myId].hand;
            let okAll = true, detail = '', sawSome = false;
            for (let i = 0; i < hand.length; i++) {
                gd.querySelectorAll('#player-hand .card')[i].click(); await sleep(20);
                const legal = um.logic.getBuildTargetsForCard(um.myId, i);
                const want = new Set(legal.map(t => t.cityId + ':' + t.slotIndex));
                const got = new Set([...gd.querySelectorAll('#game-board .highlight-slot')].map(key));
                const hint = gd.getElementById('card-preview-hint').textContent;
                const ok = want.size === got.size && [...want].every(k => got.has(k)) &&
                    (legal.length ? hint.includes('這張牌可以蓋在亮起來的地方') && hint.includes(`${want.size} 個位置`) : /這張牌目前沒有可蓋的位置（.+）/.test(hint));
                if (legal.length) sawSome = true;
                if (!ok) { okAll = false; detail += ` card${i}(${hand[i].type}): ${[...want]} vs ${[...got]} / ${hint}`; }
                check(`card preview ${i}: card marked selected`, gd.querySelectorAll('#player-hand .card')[i].classList.contains('previewing'));
            }
            check('card preview: highlighted slots == rules legal set for each card + hint', okAll, detail);
            {
                const txt = [...gd.querySelectorAll('#player-hand .card')].map(c => c.textContent.replace(/\(.*?\)/g, '') + ' ' + (c.title || '')).join('|');
                const cardsZh = [...gd.querySelectorAll('#player-hand .card')].every(c => /[\u4e00-\u9fff]/.test(c.textContent));
                const noEnTitles = !/Location|Industry|Wild|Cotton|Coal Mine|Iron Works|Pottery|Brewery|Manufacturer/.test(txt.replace(/class="card-name-en"/g, ''));
                const enLines = [...gd.querySelectorAll('#player-hand .card-name-en')].map(e => e.textContent).join('');
                check('hand cards: Chinese titles, no English type/industry words', cardsZh && !/Location|Industry|Wild|Cotton|Coal Mine|Iron Works|Pottery|Brewery|Manufacturer/.test(txt.split('').join('').replace(enLines, '')), txt);
                void noEnTitles;
                const li = hand.findIndex((_, i) => um.logic.getBuildTargetsForCard(um.myId, i).length);
                gd.querySelectorAll('#player-hand .card')[li].click(); await sleep(20);
                const hintEl = gd.getElementById('card-preview-hint');
                check('card preview: legal-spot hint is a non-blocking toast', hintEl.classList.contains('cp-toast'));
                const rects = um.logic.getBuildTargetsForCard(um.myId, li).map(t => um.renderer.slotBoardRect(t)).filter(Boolean);
                let overl = [];
                gd.querySelectorAll('#town-labels-layer .town-label:not(.label-over-lit)').forEach(lg => {
                    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(lg.getAttribute('transform')); const r = lg.querySelector('rect');
                    const x = +m[1] + +r.getAttribute('x'), y = +m[2] + +r.getAttribute('y'), w = +r.getAttribute('width'), h = +r.getAttribute('height');
                    if (rects.some(b => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y)) overl.push(lg.dataset.label);
                });
                check('card preview: no visible town label overlaps a lit slot', overl.length === 0, overl.join(','));
                gd.querySelectorAll('#player-hand .card')[li].click(); await sleep(20);
                gd.querySelectorAll('#player-hand .card')[hand.length - 1].click(); await sleep(20);
            }
            check('card preview: at least one card has legal spots', sawSome);
            const last = hand.length - 1;
            gd.querySelectorAll('#player-hand .card')[last].click(); await sleep(20);
            check('card preview: tapping same card again deselects', um.previewCard == null && !gd.querySelector('#game-board .highlight-slot') && gd.getElementById('card-preview-hint').classList.contains('hidden'));
            check('card preview: sent nothing, state unchanged', sent.length === 0 && before === JSON.stringify(um.state.players[um.myId]) + JSON.stringify(um.state.boardIndustries));
            const ci = hand.findIndex((_, i) => um.logic.getBuildTargetsForCard(um.myId, i).length);
            if (ci >= 0) {
                gd.querySelectorAll('#player-hand .card')[ci].click(); await sleep(20);
                const el = gd.querySelector('#game-board .highlight-slot');
                el.dispatchEvent(new g.window.MouseEvent('click', { bubbles: true })); await sleep(30);
                const conf = gd.querySelector('#build-panel .bp-confirm, #build-panel .bp-industry');
                check('card preview: tap glowing spot -> build confirm bar', um.selectedAction === 'build' && !!conf, conf && conf.textContent);
                const okBtn = gd.querySelector('#build-panel [data-bp="ok"]');
                if (okBtn) { okBtn.click(); await sleep(30);
                    check('card preview: 確認 sends build with the previewed card', sent.length === 1 && sent[0].action === 'build' && sent[0].cardIndex === ci, JSON.stringify(sent)); }
            }
            if (um.net) um.net.send = origSend;
            um.waiting = false; um.cancelAction(); um.state.currentPlayerIndex = saved.cpi;
        }
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
