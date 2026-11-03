'use strict';
// Rail link legality + explainNetworkTarget reasons (stafford–cannock scenarios).
const E = require('../server/engine');
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + ' ' + x); };
const td = (g, type, level) => ({ ...g.players[0].industryTiles[type].find(t => t.level === level) });
const ID = 'cannock-stafford';
function fresh() {
    const g = new E.GameState(3, ['P0', 'P1', 'P2']); g.boardIndustries = {}; g.boardLinks = {}; g.breweryFarmTiles = {};
    g.era = E.ERA.RAIL; g.players[0].money = 20; g.players[0].linksRemaining.rail = 5;
    // red owns tiles in both Stafford and Cannock (both ends in network)
    g.boardIndustries.stafford_0 = { playerId: 0, type: 'manufacturer', tileData: td(g, 'manufacturer', 2), flipped: true, resourceCubes: 0 };
    g.boardIndustries.cannock_0 = { playerId: 0, type: 'manufacturer', tileData: td(g, 'manufacturer', 2), flipped: true, resourceCubes: 0 };
    return { g, L: new E.GameLogic(g) };
}
const mine = (g, key, pid, cubes, flipped = false) => { g.boardIndustries[key] = { playerId: pid, type: 'coalMine', tileData: td(g, 'coalMine', 2), flipped, resourceCubes: cubes }; };
const ex = L => L.explainNetworkTarget(0, ID);
const valid = L => L.getValidNetworkTargets(0).some(t => t.connectionId === ID);
const consistent = L => L.getValidNetworkTargets(0).map(t => t.connectionId).sort().join() ===
    E.CONNECTIONS.filter(c => c.rail).map(c => c.id).filter(id => L.explainNetworkTarget(0, id).ok).sort().join();

{ const { L } = fresh();
  check('no coal anywhere -> noCoal', ex(L).code === 'noCoal' && !valid(L), JSON.stringify(ex(L))); check('consistent', consistent(L)); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2);
  check('opponent unflipped mine at cannock -> ok, free coal, £5', ex(L).ok && ex(L).cost === 5 && valid(L)); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 0, true);
  check('flipped (empty) mine does not count -> noCoal', ex(L).code === 'noCoal'); }
{ const { g, L } = fresh(); mine(g, 'walsall_0', 0, 1);
  g.boardLinks['cannock-walsall'] = { playerId: 2, type: 'rail' };
  check('only Cannock end reaches coal (via any player link), Stafford end none -> still ok', ex(L).ok, JSON.stringify(ex(L))); }
{ const { g, L } = fresh(); g.boardLinks['stafford-stone'] = { playerId: 1, type: 'rail' };
  g.boardLinks['stokeOnTrent-stone'] = { playerId: 1, type: 'rail' }; g.boardLinks['stokeOnTrent-warrington'] = { playerId: 1, type: 'rail' };
  const x = ex(L);
  check('connected to merchant -> market coal, cost > 5', x.ok && x.cost > 5, JSON.stringify(x));
  g.players[0].money = x.cost - 1;
  const y = ex(L);
  check('noMoney with cost & money', y.code === 'noMoney' && y.cost === x.cost && y.money === x.cost - 1 && !valid(L), JSON.stringify(y)); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2); g.players[0].money = 4;
  check('free coal but £4 < £5 -> noMoney', ex(L).code === 'noMoney' && ex(L).cost === 5); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2); g.boardLinks[ID] = { playerId: 1, type: 'rail' };
  check('already built -> built', ex(L).code === 'built' && !valid(L));
  check('built links not listed as blocked', !L.getBlockedNetworkTargets(0).some(b => b.connectionId === ID)); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2);
  delete g.boardIndustries.stafford_0; delete g.boardIndustries.cannock_0;
  g.boardIndustries.birmingham_0 = { playerId: 0, type: 'manufacturer', tileData: td(g, 'manufacturer', 2), flipped: true, resourceCubes: 0 };
  check('neither end in network -> notInNetwork', ex(L).code === 'notInNetwork' && !valid(L)); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2); g.players[0].linksRemaining.rail = 0;
  check('no rail links left -> noLinks', ex(L).code === 'noLinks' && !valid(L)); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2); g.era = E.ERA.CANAL;
  const canalOnly = E.CONNECTIONS.find(c => c.rail && !c.canal);
  check('rail-only link in canal era -> era (and excluded from blocked list)', L.explainNetworkTarget(0, canalOnly.id).code === 'era' &&
      !L.getBlockedNetworkTargets(0).some(b => b.connectionId === canalOnly.id)); }
{ // nearest mine first
  const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2); mine(g, 'walsall_0', 0, 1);
  g.boardLinks['cannock-walsall'] = { playerId: 2, type: 'rail' };
  const s = L.findCheapestCoalForLink(E.CONNECTIONS.find(c => c.id === ID), 0);
  check('closest mine (cannock, distance 0) chosen', s && s.key === 'cannock_1' && s.distance === 0, JSON.stringify(s)); }

// ---- Double rail (£15 + 1 beer from a brewery) ----
const brew = (g, key, pid, cubes) => { g.boardIndustries[key] = { playerId: pid, type: 'brewery', tileData: td(g, 'brewery', 2), flipped: false, resourceCubes: cubes }; };
const seconds = (L, first) => L.getValidSecondRailLinks(0, first).map(s => s.connectionId);
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2); brew(g, 'stafford_1', 0, 1);
  check('double: own beer + 2-cube mine -> stafford–cannock valid single', valid(L));
  check('double: cannock-stafford first, cannock-walsall second offered', seconds(L, ID).includes('cannock-walsall'), JSON.stringify(seconds(L, ID)));
  check('double: cannock-stafford offered as second after cannock-walsall', seconds(L, 'cannock-walsall').includes(ID));
  const card = g.players[0].hand.length ? 0 : (g.players[0].hand.push({ type: 'location', location: 'stafford' }), 0);
  const r = L.executeNetworkDouble(0, ID, 'cannock-walsall', card);
  check('double executes: £15, mine 2->0, beer consumed, 2 links', r.success && g.players[0].money === 5 && (g.boardIndustries.cannock_1.resourceCubes === 0) && g.players[0].linksRemaining.rail === 3, JSON.stringify(r)); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 1); brew(g, 'stafford_1', 0, 1);
  check('double: 1-cube mine cannot feed second link (no other coal) -> none offered', !seconds(L, ID).includes('cannock-walsall'), JSON.stringify(seconds(L, ID))); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2); brew(g, 'stafford_1', 0, 1); g.players[0].money = 14;
  check('double: £14 < £15 -> no second link offered, single still ok', seconds(L, ID).length === 0 && valid(L)); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2);
  check('double: no beer -> no second link', seconds(L, ID).length === 0); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2); brew(g, 'birmingham_1', 1, 1);
  check('double: unconnected opponent brewery not usable', seconds(L, ID).length === 0); }
{ const { g, L } = fresh(); mine(g, 'cannock_1', 1, 2); g.players[0].linksRemaining.rail = 1;
  check('double: only 1 rail link left -> no second', seconds(L, ID).length === 0 && valid(L)); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
