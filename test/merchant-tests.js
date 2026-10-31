'use strict';
// Merchant tile setup per official rulebook + sell validation.
const E = require('../server/engine');
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + ' ' + x); };
const count = arr => arr.reduce((m, b) => (m[b] = (m[b] || 0) + 1, m), {});
const expect = {
    2: { blank: 2, any: 1, cottonMill: 1, manufacturer: 1 },
    3: { blank: 3, any: 1, cottonMill: 1, manufacturer: 1, pottery: 1 },
    4: { blank: 3, any: 1, cottonMill: 2, manufacturer: 2, pottery: 1 },
};
const locs = { 2: ['shrewsbury', 'gloucester', 'oxford'], 3: ['shrewsbury', 'gloucester', 'oxford', 'warrington'],
    4: ['shrewsbury', 'gloucester', 'oxford', 'warrington', 'nottingham'] };
for (const n of [2, 3, 4]) {
    const seen = new Set();
    for (let k = 0; k < 40; k++) {
        const g = new E.GameState(n, Array.from({ length: n }, (_, i) => 'P' + i));
        const c = count(g.merchantTiles.map(t => t.buys));
        if (k === 0) {
            check(`${n}p tile mix matches rulebook`, JSON.stringify(Object.entries(c).sort()) === JSON.stringify(Object.entries(expect[n]).sort()), JSON.stringify(c));
            check(`${n}p merchant locations`, JSON.stringify([...new Set(g.merchantTiles.map(t => t.location))].sort()) === JSON.stringify(locs[n].sort()));
            check(`${n}p beer only beside non-blank`, g.merchantTiles.every(t => t.hasBeer === (t.buys !== 'blank')));
            const back = E.restoreState(E.dumpState(g));
            check(`${n}p merchant tiles survive state sync`, JSON.stringify(back.merchantTiles) === JSON.stringify(g.merchantTiles));
        }
        seen.add(g.merchantTiles.map(t => t.buys).join(','));
    }
    check(`${n}p deal is random`, seen.size > 3, 'distinct=' + seen.size);
}
// Sell: only to a connected merchant accepting the good; merchant beer used & bonus
{
    const g = new E.GameState(2, ['A', 'B']);
    g.merchantTiles = [
        { location: 'shrewsbury', buys: 'blank', hasBeer: false },
        { location: 'gloucester', buys: 'pottery', hasBeer: true }, { location: 'gloucester', buys: 'blank', hasBeer: false },
        { location: 'oxford', buys: 'cottonMill', hasBeer: true }, { location: 'oxford', buys: 'blank', hasBeer: false },
    ];
    const L = new E.GameLogic(g);
    const conn = Object.keys(g.boardLinks || {}); void conn;
    check('accepts: any matches all', g.merchantTileAccepts({ buys: 'any' }, 'pottery'));
    check('accepts: blank matches none', !g.merchantTileAccepts({ buys: 'blank' }, 'cottonMill'));
    check('accepts: cotton tile rejects pottery', !g.merchantTileAccepts({ buys: 'cottonMill' }, 'pottery'));
    // Place cotton mill in Oxford-adjacent town with a link to oxford
    const CONN = E.GameLogic && null; void CONN;
    const tileData = { ...g.players[0].industryTiles.cottonMill[0] };
    g.boardIndustries = { 'birmingham_0': { playerId: 0, type: 'cottonMill', tileData, flipped: false, resourceCubes: 0 } };
    g.boardLinks = { 'birmingham-oxford': { playerId: 0, type: 'canal' } };
    const idx = L.getSellMerchantsFor(0, 'birmingham', 'cottonMill');
    check('cotton sells to connected Oxford cotton tile', idx.length === 1 && g.merchantTiles[idx[0]].location === 'oxford', JSON.stringify(idx));
    check('pottery cannot sell to Oxford cotton tile', L.getSellMerchantsFor(0, 'birmingham', 'pottery').length === 0);
    g.boardLinks = {};
    check('unconnected: no merchant', L.getSellMerchantsFor(0, 'birmingham', 'cottonMill').length === 0);
}
console.log(`\nmerchant tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
