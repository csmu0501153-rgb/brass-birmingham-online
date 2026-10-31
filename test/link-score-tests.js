'use strict';
// Link VP badge (linkScoreBreakdown) must match calculateEraScore link VP.
const E = require('../server/engine');
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + ' ' + x); };
const td = (g, type, level) => ({ ...g.players[0].industryTiles[type].find(t => t.level === level) });
function fresh(n = 3) { const g = new E.GameState(n, Array.from({ length: n }, (_, i) => 'P' + i)); g.boardIndustries = {}; g.boardLinks = {}; g.breweryFarmTiles = {}; return g; }
const put = (g, key, pid, type, lvl, flipped) => { g.boardIndustries[key] = { playerId: pid, type, tileData: td(g, type, lvl), flipped, resourceCubes: 0 }; };
const sumBadges = (g, pid) => Object.entries(g.boardLinks).filter(([, l]) => l.playerId === pid).reduce((a, [id]) => a + E.linkScoreBreakdown(g, id).total, 0);

{ const g = fresh(); g.era = E.ERA.RAIL;
  put(g, 'birmingham_0', 1, 'manufacturer', 5, true);
  put(g, 'birmingham_2', 1, 'ironWorks', 2, true);
  put(g, 'coventry_1', 0, 'coalMine', 2, false);
  g.boardLinks['birmingham-coventry'] = { playerId: 0, type: 'rail' };
  g.boardLinks['birmingham-oxford'] = { playerId: 0, type: 'rail' };
  g.breweryFarmTiles.southern = { playerId: 1, type: 'brewery', tileData: td(g, 'brewery', 2), flipped: true, resourceCubes: 0 };
  g.boardLinks['kidderminster-worcester'] = { playerId: 1, type: 'rail' };
  const b = E.linkScoreBreakdown(g, 'birmingham-coventry');
  check('breakdown birmingham +3, coventry +0 (unflipped)', b.total === 3 && b.parts.find(p => p.location === 'coventry').vp === 0, JSON.stringify(b));
  check('merchant end +2', E.linkScoreBreakdown(g, 'birmingham-oxford').parts.find(p => p.location === 'oxford').vp === 2);
  check('via brewery farm counted', E.linkScoreBreakdown(g, 'kidderminster-worcester').total === 2);
  const badges = [0, 1, 2].map(p => sumBadges(g, p));
  const s = g.calculateEraScore();
  check('badges == calculateEraScore linkVP per player', s.every((x, i) => x.linkVP === badges[i]), JSON.stringify(badges) + ' ' + JSON.stringify(s.map(x => x.linkVP)));
  put(g, 'coventry_1', 0, 'coalMine', 2, true);
  check('badge updates after flip', E.linkScoreBreakdown(g, 'birmingham-coventry').total === 3 + td(g, 'coalMine', 2).linkVP);
}
// Randomised parity
{ let ok = true;
  for (let r = 0; r < 200; r++) {
    const g = fresh(); g.era = E.ERA.CANAL;
    const keys = []; for (const id of ['birmingham', 'coventry', 'dudley', 'walsall', 'stoke', 'leek', 'derby', 'burton', 'tamworth', 'nuneaton', 'cannock', 'redditch', 'worcester']) for (let i = 0; i < 2; i++) keys.push(id + '_' + i);
    for (const k of keys) if (Math.random() < 0.5) put(g, k, Math.floor(Math.random() * 3), ['coalMine', 'cottonMill', 'brewery', 'pottery'][Math.floor(Math.random() * 4)], 1, Math.random() < 0.5);
    for (const id of ['birmingham-coventry', 'birmingham-oxford', 'birmingham-dudley', 'birmingham-walsall', 'coventry-nuneaton', 'kidderminster-worcester', 'birmingham-redditch'])
      if (Math.random() < 0.7) g.boardLinks[id] = { playerId: Math.floor(Math.random() * 3), type: 'canal' };
    const badges = [0, 1, 2].map(p => sumBadges(g, p));
    const s = g.calculateEraScore();
    if (!s.every((x, i) => x.linkVP === badges[i])) { ok = false; console.log(JSON.stringify(badges), JSON.stringify(s)); break; }
  }
  check('200 random states: badges == calculateEraScore', ok);
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
