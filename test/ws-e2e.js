'use strict';
// End-to-end: craft room states, persist them, boot the REAL server
// (node server/index.js) and drive builds/sells over websocket exactly like
// the browser ({type:'action', action, cardIndex, pendingData}).
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { Room } = require('../server/rooms.js');
const E = require('../server/engine');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-e2e-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };

function base(era = 'canal') {
    const room = Room.create([{ name: 'Human' }, { name: 'Bot', isAI: true }]);
    const s = room.state;
    s.turnOrder = [0, 1]; s.currentPlayerIndex = 0; s.era = era; s.actionsThisTurn = 0; s.actionsPerTurn = 2;
    for (const k of Object.keys(s.boardIndustries)) delete s.boardIndustries[k];
    for (const k of Object.keys(s.boardLinks)) delete s.boardLinks[k];
    s.players[0].money = 60; s.boardLinks['birmingham-oxford'] = { playerId: 1, type: era };
    s.merchantTiles.forEach(m => { if (m.location === 'oxford' || m.location === 'gloucester') { m.buys = 'any'; m.hasBeer = true; } });
    if (era === 'rail') for (const t of Object.values(s.players[0].industryTiles)) t.forEach(x => { if (x.level === 1) x.used = true; });
    return room;
}
const tile = (room, pid, type, lvl, cubes, extra = {}) => ({ playerId: pid, type, tileData: { ...room.state.players[pid].industryTiles[type].find(t => t.level === lvl) }, flipped: false, resourceCubes: cubes, ...extra });
const card = (room, c) => room.state.players[0].hand.unshift({ uid: 'x' + Math.random(), ...c });

const scen = [];
function addBuild(name, room, type, cityId, slot, expect) { scen.push({ kind: 'build', name, room, pd: { cityId, slotIndex: slot, industryType: type }, expect }); }

// Iron works scenarios (Birmingham slot 2 is iron)
{ const r = base(); r.state.ironMarket = 8; card(r, { type: 'wildLocation' });
  addBuild('iron normal canal, market 8/10 (wild card)', r, 'ironWorks', 'birmingham', 2, { sold: 2 }); }
{ const r = base(); r.state.ironMarket = 0; card(r, { type: 'location', location: 'birmingham' });
  addBuild('iron, empty iron market (sell all 4)', r, 'ironWorks', 'birmingham', 2, { sold: 4, flipped: true }); }
{ const r = base(); r.state.ironMarket = 10; card(r, { type: 'wildLocation' });
  addBuild('iron, market full', r, 'ironWorks', 'birmingham', 2, { sold: 0 }); }
{ const r = base(); r.state.ironMarket = 5; r.state.coalMarket = 0; card(r, { type: 'wildLocation' });
  addBuild('iron, coal needed from empty coal market (£8)', r, 'ironWorks', 'birmingham', 2, { sold: 4, flipped: true }); }
{ const r = base('rail'); r.state.ironMarket = 6; card(r, { type: 'wildLocation' });
  r.state.boardIndustries.birmingham_2 = tile(r, 0, 'ironWorks', 1, 0, { flipped: true });
  addBuild('iron overbuild own L1 in rail era', r, 'ironWorks', 'birmingham', 2, { sold: 4, flipped: true }); }
{ const r = base(); r.state.ironMarket = 7; r.state.players[0].hand = [{ uid: 'a', type: 'wildIndustry' }, ...r.state.players[0].hand];
  r.state.boardLinks['birmingham-oxford'].playerId = 0; // own link => in network
  addBuild('iron with wild industry, first turn canal', r, 'ironWorks', 'birmingham', 2, { sold: 3 }); }
// Coal mine (Redditch slot 0)
{ const r = base(); r.state.coalMarket = 10; card(r, { type: 'wildLocation' });
  r.state.boardLinks['redditch-oxford'] = { playerId: 1, type: 'canal' };
  addBuild('coal connected to Oxford, market 10/14', r, 'coalMine', 'redditch', 0, { sold: 2, flipped: true }); }
{ const r = base(); r.state.coalMarket = 10; card(r, { type: 'wildLocation' });
  addBuild('coal NOT connected to merchant', r, 'coalMine', 'redditch', 0, { sold: 0 }); }
{ const r = base(); r.state.coalMarket = 13; card(r, { type: 'wildLocation' });
  r.state.boardLinks['redditch-oxford'] = { playerId: 1, type: 'canal' };
  addBuild('coal connected, initial market 13/14', r, 'coalMine', 'redditch', 0, { sold: 1 }); }
// Sell with beer
function addSell(name, room, plan, expect) { scen.push({ kind: 'sell', name, room, plan, expect }); }
{ const r = base(); card(r, { type: 'wildLocation' });
  r.state.boardLinks['redditch-oxford'] = { playerId: 0, type: 'canal' };
  r.state.boardIndustries.redditch_0 = tile(r, 0, 'manufacturer', 1, 0);
  r.state.boardIndustries.birmingham_1 = tile(r, 0, 'brewery', 1, 1); // own brewery, not connected
  r.state.merchantTiles.forEach(m => m.hasBeer = false);
  addSell('sell goods with OWN brewery beer (unconnected)', r, [{ key: 'redditch_0', useMerchantBeer: false }], { soldKey: 'redditch_0', beerFrom: 'birmingham_1' }); }
{ const r = base(); card(r, { type: 'wildLocation' });
  r.state.boardLinks['redditch-oxford'] = { playerId: 0, type: 'canal' };
  r.state.boardIndustries.redditch_0 = tile(r, 0, 'manufacturer', 1, 0);
  addSell('sell goods with merchant beer (Oxford +2 income)', r, [{ key: 'redditch_0', useMerchantBeer: true }], { soldKey: 'redditch_0', merchantBeer: true }); }
{ const r = base(); card(r, { type: 'wildLocation' });
  r.state.boardLinks['redditch-oxford'] = { playerId: 0, type: 'canal' };
  r.state.boardLinks['birmingham-oxford'] = { playerId: 1, type: 'canal' };
  r.state.boardIndustries.redditch_0 = tile(r, 0, 'manufacturer', 1, 0);
  r.state.boardIndustries.birmingham_1 = tile(r, 1, 'brewery', 1, 1);
  r.state.merchantTiles.forEach(m => m.hasBeer = false);
  addSell('sell goods with connected OPPONENT beer', r, [{ key: 'redditch_0', useMerchantBeer: false }], { soldKey: 'redditch_0', beerFrom: 'birmingham_1' }); }
{ const r = base(); card(r, { type: 'wildLocation' });
  r.state.boardLinks['coventry-nuneaton'] = { playerId: 0, type: 'canal' };
  r.state.boardLinks['birmingham-oxford'] = { playerId: 0, type: 'canal' };
  r.state.boardLinks['birmingham-coventry'] = { playerId: 0, type: 'canal' };
  r.state.boardIndustries.coventry_0 = tile(r, 0, 'pottery', 3, 0);  // needs 2 beer
  r.state.boardIndustries.birmingham_1 = tile(r, 0, 'brewery', 1, 1);
  addSell('pottery L3 needs 2 beer: 1 merchant + 1 own', r, [{ key: 'coventry_0', useMerchantBeer: true }], { soldKey: 'coventry_0', merchantBeer: true, beerFrom: 'birmingham_1' }); }

for (const sc of scen) { sc.id = sc.room.id; sc.token = sc.room.seats[0].token; fs.writeFileSync(path.join(DIR, `room-${sc.id}.json`), JSON.stringify(sc.room.toJSON())); }

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT, DATA_DIR: DIR }, stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise(res => srv.stdout.on('data', d => { if (/listening|on :/.test(String(d))) res(); }));

function session(sc) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${sc.id}&token=${sc.token}`);
        let before = null, result = null; const timer = setTimeout(() => { ws.close(); reject(new Error('timeout ' + sc.name)); }, 8000);
        ws.on('message', d => {
            const m = JSON.parse(String(d));
            if (m.type === 'state' && !before) {
                before = m;
                const st = E.restoreState(JSON.stringify(m.view)); const L = new E.GameLogic(st);
                let msg;
                if (sc.kind === 'build') {
                    const ci = L.getValidCardsForAction(0, E.ACTIONS.BUILD, sc.pd)[0];
                    msg = { type: 'action', action: E.ACTIONS.BUILD, cardIndex: ci, pendingData: sc.pd, requestId: 1 };
                } else {
                    const ci = L.getValidCardsForAction(0, E.ACTIONS.SELL)[0];
                    sc.targets = L.getValidSellTargets(0);
                    msg = { type: 'action', action: E.ACTIONS.SELL, cardIndex: ci, pendingData: { sellPlan: sc.plan }, requestId: 1 };
                }
                ws.send(JSON.stringify(msg));
            } else if (m.type === 'result') { result = m; ws.send(JSON.stringify({ type: 'sync' })); }
            else if (m.type === 'state' && result) { clearTimeout(timer); ws.close(); resolve({ before, after: m, result }); }
        });
        ws.on('error', reject);
    });
}

(async () => {
    await ready;
    for (const sc of scen) {
        let r; try { r = await session(sc); } catch (e) { check(sc.name, false, e.message); continue; }
        const b = r.before.view, a = r.after.view, p0b = b.players[0], p0a = a.players[0];
        console.log(`\n== ${sc.name}\n   result: ${r.result.ok} "${r.result.message}"`);
        console.log(`   iron ${b.ironMarket}->${a.ironMarket}  coal ${b.coalMarket}->${a.coalMarket}  money ${p0b.money}->${p0a.money}  income ${p0b.income}->${p0a.income} vp ${p0b.vp}->${p0a.vp}`);
        check(`${sc.name}: action ok`, r.result.ok, r.result.message);
        if (sc.kind === 'build') {
            const key = `${sc.pd.cityId}_${sc.pd.slotIndex}`, t = a.boardIndustries[key];
            const iron = sc.pd.industryType === 'ironWorks';
            const mk = iron ? a.ironMarket - b.ironMarket : a.coalMarket - b.coalMarket;
            console.log(`   tile cubes ${t && t.resourceCubes} flipped ${t && t.flipped}`);
            check(`${sc.name}: market +${sc.expect.sold}`, mk === sc.expect.sold, `got +${mk}`);
            if (sc.expect.flipped) check(`${sc.name}: tile flipped`, t && t.flipped);
            check(`${sc.name}: tile cubes = printed - sold`, t && t.resourceCubes === t.tileData.resourceCubes - sc.expect.sold, t && t.resourceCubes);
        } else {
            console.log(`   sell targets offered: ${sc.targets.map(t => t.key + '(beer ' + t.beerNeeded + ')').join(', ')}`);
            check(`${sc.name}: tile flipped`, a.boardIndustries[sc.expect.soldKey].flipped);
            if (sc.expect.beerFrom) check(`${sc.name}: brewery beer consumed`, a.boardIndustries[sc.expect.beerFrom].resourceCubes === b.boardIndustries[sc.expect.beerFrom].resourceCubes - 1);
            if (sc.expect.merchantBeer) check(`${sc.name}: merchant barrel used`, a.merchantTiles.filter(m => m.hasBeer).length === b.merchantTiles.filter(m => m.hasBeer).length - 1);
        }
    }
    srv.kill('SIGTERM');
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
