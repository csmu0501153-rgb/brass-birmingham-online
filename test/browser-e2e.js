'use strict';
// Real-browser e2e (headless Chrome via puppeteer-core): click through Build
// Iron Works and Sell-with-beer in the real UI against the real server.
// Usage: node test/browser-e2e.js  (needs puppeteer-core + google-chrome; skips otherwise)
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch (_) { try { puppeteer = require('/tmp/pp/node_modules/puppeteer-core'); } catch (e) { console.log('SKIP no puppeteer-core'); process.exit(0); } }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
if (!fs.existsSync(CHROME)) { console.log('SKIP no chrome'); process.exit(0); }
const { Room } = require('../server/rooms.js');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-br-'));
const PORT = 4000 + Math.floor(Math.random() * 90);
const SHOTS = process.env.SHOTS || path.join(__dirname, '..', 'screenshots');
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function room(mut) {
    const r = Room.create([{ name: 'Human' }, { name: 'Bot', isAI: true }]);
    const s = r.state; s.turnOrder = [0, 1]; s.currentPlayerIndex = 0; s.actionsThisTurn = 0; s.actionsPerTurn = 2;
    for (const k of Object.keys(s.boardIndustries)) delete s.boardIndustries[k];
    for (const k of Object.keys(s.boardLinks)) delete s.boardLinks[k];
    s.players[0].money = 60; s.players[0].hand = Array.from({ length: 8 }, (_, i) => ({ type: 'wildLocation', uid: 'w' + i }));
    s.boardLinks['birmingham-oxford'] = { playerId: 1, type: 'canal' };
    s.merchantTiles.forEach(m => { if (m.location === 'oxford') { m.buys = 'any'; m.hasBeer = true; } });
    mut(r, s);
    fs.writeFileSync(path.join(DIR, `room-${r.id}.json`), JSON.stringify(r.toJSON()));
    return `http://127.0.0.1:${PORT}/?room=${r.id}&token=${r.seats[0].token}`;
}
const ironUrl = room((r, s) => { s.ironMarket = 8; });
const sellUrl = room((r, s) => {
    s.boardLinks['redditch-oxford'] = { playerId: 0, type: 'canal' };
    const t = (pid, type, lvl, cubes) => ({ playerId: pid, type, tileData: { ...s.players[pid].industryTiles[type].find(x => x.level === lvl) }, flipped: false, resourceCubes: cubes });
    s.boardIndustries.redditch_0 = t(0, 'manufacturer', 1, 0);
    s.boardIndustries.birmingham_1 = t(1, 'brewery', 1, 1); // opponent beer, connected via Oxford
    s.merchantTiles.forEach(m => m.hasBeer = false);
});
const cardUrl = room((r, s) => {
    s.ironMarket = 8;
    s.players[0].hand = [
        { type: 'location', location: 'coventry', name: 'Coventry', uid: 'c1' },
        { type: 'industry', industryTypes: ['ironWorks'], name: 'Iron Works', uid: 'c2' },
        { type: 'wildLocation', uid: 'c3' },
        { type: 'industry', industryTypes: ['brewery'], name: 'Brewery', uid: 'c4' },
    ];
    s.boardIndustries.redditch_0 = { playerId: 0, type: 'coalMine', tileData: { ...s.players[0].industryTiles.coalMine.find(x => x.level === 1) }, flipped: false, resourceCubes: 2 };
    s.players[0].money = 12; // limited money -> mixed legal sets
});

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT, DATA_DIR: DIR }, stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise(res => srv.stdout.on('data', d => { if (/on :/.test(String(d))) res(); }));

(async () => {
    await ready;
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
    try {
        const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 900 });
        const errs = []; page.on('pageerror', e => errs.push(e.message));
        const toasts = [];
        await page.exposeFunction('__toast', t => toasts.push(t));
        await page.evaluateOnNewDocument(() => {
            new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.classList && n.classList.contains('toast') && window.__toast(n.textContent))))
                .observe(document, { childList: true, subtree: true });
        });
        const dom = () => page.evaluate(() => {
            const um = window.uiManager, me = um.state.players[0];
            return { ironFilled: document.querySelectorAll('#iron-track .filled').length, coalFilled: document.querySelectorAll('#coal-track .filled').length,
                ironPrice: document.getElementById('iron-current-price').textContent, money: me.money,
                tiles: Object.fromEntries(Object.entries(um.state.boardIndustries).map(([k, t]) => [k, { c: t.resourceCubes, f: t.flipped }])),
                log: [...document.querySelectorAll('#game-log > *')].slice(-3).map(e => e.textContent.trim()) };
        });
        const waitUi = () => page.waitForFunction(() => window.uiManager && window.uiManager.isMyTurn(), { timeout: 15000 });
        // ---- Build iron works through the UI
        await page.goto(ironUrl); await waitUi(); await sleep(500);
        const b = await dom();
        await page.click('.action-btn[data-action="build"]'); await sleep(200);
        await page.click('#build-panel .bp-industry[data-type="ironWorks"]'); await sleep(200);
        await page.click('#build-panel .bp-slot[data-city="birmingham"]'); await sleep(200);
        await page.click('#build-panel [data-bp="ok"]'); await sleep(200);
        await page.click('#player-hand .card'); await sleep(200);
        await page.waitForFunction(() => !window.uiManager.waiting, { timeout: 5000 }); await sleep(600);
        const a = await dom();
        await page.screenshot({ path: path.join(SHOTS, 'e2e-iron-autosell.png') });
        console.log('IRON before', JSON.stringify({ iron: b.ironFilled, money: b.money }), 'after', JSON.stringify({ iron: a.ironFilled, price: a.ironPrice, money: a.money, tile: a.tiles.birmingham_2 }));
        console.log('  toast:', toasts.join(' | ')); console.log('  log:', a.log.join(' | '));
        check('UI build: iron market DOM shows 10 filled (was 8)', b.ironFilled === 8 && a.ironFilled === 10, `${b.ironFilled}->${a.ironFilled}`);
        check('UI build: 2 iron left on tile', a.tiles.birmingham_2 && a.tiles.birmingham_2.c === 2);
        check('UI build: money 60 - £5 - £1 coal + £2', a.money === 56, a.money);
        check('UI build: toast mentions 賣出 2 塊鐵', toasts.some(t => /自動賣出 2 塊鐵，收 £2；市場已滿，板塊上還剩 2 塊/.test(t)), toasts.join('|'));
        // ---- Sell manufacturer using opponent beer through the UI
        toasts.length = 0;
        await page.goto(sellUrl); await waitUi(); await sleep(500);
        await page.click('.action-btn[data-action="sell"]'); await sleep(300);
        const items = await page.$$eval('#modal-body .choice-item', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
        console.log('SELL dialog items:', items);
        check('UI sell: manufacturer offered with beer cost shown', items.length === 1 && /啤酒|Beer/.test(items[0]) && /1/.test(items[0]), items.join('|'));
        check('UI sell: dialog says which merchant buys it', /賣給：牛津商人（全部/.test(items[0]) && /已用完/.test(items[0]), items[0]);
        await page.screenshot({ path: path.join(SHOTS, 'e2e-sell-dialog.png') });
        await page.click('#modal-body .choice-item'); await page.click('#confirm-sell'); await sleep(200);
        await page.click('#player-hand .card');
        await page.waitForFunction(() => !window.uiManager.waiting, { timeout: 5000 }); await sleep(600);
        const s2 = await dom();
        console.log('  toast:', toasts.join(' | '), ' tiles:', JSON.stringify(s2.tiles));
        check('UI sell: manufacturer flipped', s2.tiles.redditch_0.f);
        check('UI sell: opponent brewery beer consumed', s2.tiles.birmingham_1.c === 0);
        check('UI sell: toast fully Chinese (no "Sold")', toasts.some(t => /賣出了? 製造商 等級1/.test(t)) && !toasts.some(t => /Sold/.test(t)), toasts.join('|'));
        // ---- Mobile map screenshot: merchants + legend + popup
        {
            const MS = process.env.MERCHANT_SHOTS || '/workspace/merchant-shots';
            fs.mkdirSync(MS, { recursive: true });
            await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
            await page.goto(ironUrl); await waitUi(); await sleep(800);
            await page.screenshot({ path: path.join(MS, 'mobile-map.png') });
            await page.evaluate(() => { const b = document.querySelector('#board-container'); if (b) b.scrollTo(0, 0); window.uiManager.boardRenderer && 0; });
            const n = await page.$$eval('#merchants-layer .merchant-goods', e => e.length);
            check('mobile: merchant goods badges on map', n >= 5, n);
            await page.evaluate(() => window.uiManager.showMerchantInfo('oxford')); await sleep(300);
            const pop = await page.$eval('#modal-body', e => e.textContent);
            check('mobile: merchant popup lists goods + bonus', /牛津商人/.test(pop) && /收入 \+2/.test(pop) && /全部/.test(pop), pop);
            await page.screenshot({ path: path.join(MS, 'mobile-merchant-popup.png') });
            await page.evaluate(() => { document.querySelector('.modal-close, #modal-close')?.click(); window.uiManager.hideModal && window.uiManager.hideModal(); });
            await page.evaluate(() => document.getElementById('merchant-legend-panel').scrollIntoView());
            await sleep(300);
            await page.screenshot({ path: path.join(MS, 'mobile-merchant-legend.png') });
            const zoomedClip = await page.evaluate(() => { const r = document.getElementById('game-board').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + window.scrollY), width: Math.min(390, r.width), height: Math.min(600, r.height) }; });
            void zoomedClip;
            await page.evaluate(() => window.scrollTo(0, 0));
            for (let k = 0; k < 2; k++) { await page.evaluate(() => [...document.querySelectorAll('.board-zoom button')][0].click()); await sleep(250); }
            await page.screenshot({ path: path.join(MS, 'mobile-map-zoomed.png') });
        }
        // ---- Card preview on mobile: tap a hand card -> its legal spots glow
        {
            const CS = process.env.CARD_SHOTS || '/workspace/card-shots';
            fs.mkdirSync(CS, { recursive: true });
            await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
            await page.goto(cardUrl); await waitUi(); await sleep(800);
            const n = await page.$$eval('#player-hand .card', e => e.length);
            for (let i = 0; i < n; i++) {
                await page.tap(`#player-hand .card:nth-child(${i + 1})`); await sleep(300);
                const r = await page.evaluate(i => {
                    const um = window.uiManager;
                    const want = [...new Set(um.logic.getBuildTargetsForCard(um.myId, i).map(t => t.cityId + ':' + t.slotIndex))].sort();
                    const got = [...new Set([...document.querySelectorAll('#game-board .highlight-slot')].map(e => e.dataset.farm ? e.dataset.farm + ':0' : e.dataset.city + ':' + e.dataset.slot))].sort();
                    return { want, got, hint: document.getElementById('card-preview-hint').textContent, type: um.state.players[um.myId].hand[i].type };
                }, i);
                console.log(`CARD ${i} ${r.type}: ${r.want.length} spots; hint: ${r.hint}`);
                check(`mobile card ${i}: glowing slots == rules legal set`, JSON.stringify(r.want) === JSON.stringify(r.got), r.want + ' vs ' + r.got);
                check(`mobile card ${i}: hint text`, r.want.length ? /這張牌可以蓋在亮起來的地方/.test(r.hint) : /這張牌目前沒有可蓋的位置（.+）/.test(r.hint), r.hint);
                await page.screenshot({ path: path.join(CS, `card-${i}-${r.type}.png`) });
                await page.tap(`#player-hand .card:nth-child(${i + 1})`); await sleep(200);
                check(`mobile card ${i}: tap again deselects`, await page.evaluate(() => window.uiManager.previewCard == null && !document.querySelector('#game-board .highlight-slot')));
            }
            // Location card (Coventry) -> tap glowing slot -> confirm -> server builds
            await page.tap('#player-hand .card:nth-child(1)'); await sleep(300);
            const slotKey = await page.evaluate(() => { const um = window.uiManager; const t = um.logic.getBuildTargetsForCard(um.myId, 0)[0]; return t && { c: t.cityId, s: t.slotIndex, ty: t.industryType }; });
            if (slotKey) {
                await page.evaluate(k => document.querySelector(`#game-board .industry-slot[data-city="${k.c}"][data-slot="${k.s}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), slotKey);
                await sleep(400);
                await page.screenshot({ path: path.join(CS, 'card-confirm-bar.png') });
                const hasOk = await page.$('#build-panel [data-bp="ok"]');
                check('mobile: tap glowing spot opens build confirm bar', !!hasOk);
                if (hasOk) { await page.tap('#build-panel [data-bp="ok"]'); await page.waitForFunction(() => !window.uiManager.waiting, { timeout: 5000 }); await sleep(600); }
                const built = await page.evaluate(k => window.uiManager.state.boardIndustries[k.c + '_' + k.s], slotKey);
                check('mobile: server accepted build paid by the previewed card', built && built.playerId === 0 && built.type === slotKey.ty, JSON.stringify(built));
                await page.screenshot({ path: path.join(CS, 'card-built.png') });
            } else check('mobile: Coventry location card has a legal spot', false);
        }
        check('no page errors', errs.length === 0, errs.join('\n'));
    } finally { await browser.close(); srv.kill('SIGTERM'); }
    console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
