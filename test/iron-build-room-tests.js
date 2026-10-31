'use strict';
// Regression: Iron Works built through the real server path (Room.applyAction
// with the same {action, cardIndex, pendingData} the browser sends) must sell
// iron into empty market spaces regardless of connection, most expensive first,
// pay the builder, and the per-seat state view must reflect it.
const { Room } = require('../server/rooms.js');
const E = require('../server/engine');
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + ' ' + (c ? '' : x)); };

function setup({ ironMarket, era = 'canal', ownExisting = null, cardType = 'wildLocation' }) {
    const room = Room.create([{ name: 'A' }, { name: 'B' }]);
    const s = room.state, p = s.currentPlayerId, o = 1 - p, pl = s.players[p];
    s.era = era; s.ironMarket = ironMarket; pl.money = 50;
    for (const k of Object.keys(s.boardIndustries)) delete s.boardIndustries[k];
    for (const k of Object.keys(s.boardLinks)) delete s.boardLinks[k];
    // Coal for the build comes from an OPPONENT mine in the same town, so the
    // builder has no links and no merchant connection at all.
    s.boardIndustries['birmingham_0'] = { playerId: o, type: 'coalMine', tileData: { ...s.players[o].industryTiles.coalMine[0] }, flipped: false, resourceCubes: 2 };
    if (ownExisting) s.boardIndustries[ownExisting.key] = ownExisting.tile;
    pl.hand.unshift({ type: cardType, uid: 'test' });
    if (era === 'rail') { pl.industryTiles.ironWorks[0].used = true; }
    return { room, s, p, pl };
}
function build(ctx, filter = () => true) {
    const { room, p } = ctx, L = room.logic;
    const t = L.getValidBuildTargets(p).find(t => t.industryType === 'ironWorks' && t.cityId === 'birmingham' && filter(t));
    if (!t) return null;
    const pd = { cityId: t.cityId, slotIndex: t.slotIndex, industryType: t.industryType };
    const ci = L.getValidCardsForAction(p, E.ACTIONS.BUILD, pd)[0];
    const money0 = room.state.players[p].money;
    const res = room.applyAction(p, { action: E.ACTIONS.BUILD, cardIndex: ci, pendingData: pd });
    const key = `${t.cityId}_${t.slotIndex}`;
    return { t, res, key, money0, tile: room.state.boardIndustries[key], view: room.viewFor(p).view };
}

for (const [label, opts] of [['L1 canal', { ironMarket: 8 }], ['L2 rail', { ironMarket: 8, era: 'rail' }]]) {
    const ctx = setup(opts);
    const b = build(ctx);
    check(`${label}: build target exists (unconnected builder)`, !!b);
    if (!b) continue;
    const n = b.t.tileData.resourceCubes;
    check(`${label}: success`, b.res.success, b.res.message);
    check(`${label}: market filled to 10`, ctx.room.state.ironMarket === 10, ctx.room.state.ironMarket);
    check(`${label}: N-2 cubes stay on tile`, b.tile.resourceCubes === n - 2 && !b.tile.flipped, b.tile.resourceCubes);
    check(`${label}: paid £1+£1 immediately`, ctx.room.state.players[ctx.p].money === b.money0 - b.t.cost.total + 2,
        `${b.money0} -> ${ctx.room.state.players[ctx.p].money}`);
    check(`${label}: message`, /auto-sold 2 iron to market for £2; market full, \d+ left on tile/.test(b.res.message), b.res.message);
    check(`${label}: state view has market + tile cubes`, b.view.ironMarket === 10 && b.view.boardIndustries[b.key].resourceCubes === n - 2);
}
// Overbuild own iron works (rail era, L1 -> L2)
{
    const ctx = setup({ ironMarket: 8, era: 'rail' });
    const s = ctx.s;
    // put own L1 iron works on birmingham's iron slot
    const L = ctx.room.logic;
    const t0 = L.getValidBuildTargets(ctx.p).find(t => t.industryType === 'ironWorks' && t.cityId === 'birmingham');
    s.boardIndustries[`birmingham_${t0.slotIndex}`] = { playerId: ctx.p, type: 'ironWorks', tileData: { ...s.players[ctx.p].industryTiles.ironWorks[0] }, flipped: true, resourceCubes: 0 };
    const b = build(ctx, t => t.slotIndex === t0.slotIndex);
    check('overbuild: success', b && b.res.success, b && b.res.message);
    if (b) check('overbuild: 2 sold, rest stays', ctx.room.state.ironMarket === 10 && b.tile.resourceCubes === b.t.tileData.resourceCubes - 2);
}
// Market with 0 empty spaces / fully empty market
{
    const ctx = setup({ ironMarket: 10 }); const b = build(ctx);
    check('full market: nothing sold', ctx.room.state.ironMarket === 10 && b.tile.resourceCubes === b.t.tileData.resourceCubes && /market full/.test(b.res.message));
}
{
    const ctx = setup({ ironMarket: 0 }); const b = build(ctx);
    check('empty market: 4 cubes fill £5,£5,£4,£4 = £18, flips', ctx.room.state.ironMarket === 4 && b.tile.flipped &&
        ctx.room.state.players[ctx.p].money === b.money0 - b.t.cost.total + 18);
}
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
