'use strict';
// Second audit: scoring / flip / legality scenarios vs official rulebook v2018.11
const E = require('../server/engine');
let pass=0, fail=0;
const check=(n,c,x='')=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+' '+x);};
const td=(g,type,level)=>({...g.players[0].industryTiles[type].find(t=>t.level===level)});
function fresh(n=2){ const g=new E.GameState(n,Array.from({length:n},(_,i)=>'P'+i)); g.boardIndustries={}; g.boardLinks={}; g.breweryFarmTiles={}; return g; }
const put=(g,key,pid,type,lvl,flipped,cubes=0)=>{g.boardIndustries[key]={playerId:pid,type,tileData:td(g,type,lvl),flipped,resourceCubes:cubes};};

// Setup
for (const [n,deck,merch] of [[2,40,5],[3,54,7],[4,64,9]]) {
  const g=new E.GameState(n,Array.from({length:n},(_,i)=>'P'+i));
  const total=g.drawDeck.length+g.players.reduce((a,p)=>a+p.hand.length,0)+n; // + seeded discard
  check(`${n}p deck size ${deck}`, total===deck, 'got '+total);
  check(`${n}p merchant tiles ${merch}`, g.merchantTiles.length===merch);
  check(`${n}p £17, income level 0, 8 cards`, g.players.every(p=>p.money===17&&g.getIncomeLevel(p.id)===0&&p.hand.length===8));
}
// Rail scoring: link icons at both ends incl. merchant(2) and farm via-link, flipped only
{ const g=fresh(); g.era=E.ERA.RAIL;
  put(g,'birmingham_0',1,'manufacturer',5,true);   // link 2, vp 8
  put(g,'birmingham_2',1,'ironWorks',2,true);      // link 1, vp 5
  put(g,'coventry_1',0,'coalMine',2,false,1);      // unflipped: 0
  g.boardLinks['birmingham-coventry']={playerId:0,type:'rail'}; // 3
  g.boardLinks['birmingham-oxford']={playerId:0,type:'rail'};   // 3+2=5
  g.breweryFarmTiles.southern={playerId:1,type:'brewery',tileData:td(g,'brewery',2),flipped:true,resourceCubes:0}; // link2 vp5
  g.boardLinks['kidderminster-worcester']={playerId:1,type:'rail'}; // 2
  const s=g.endGame();
  check('rail link VP P0 = 3+5 = 8', s[0].linkVP===8, JSON.stringify(s[0]));
  check('P1 link 2 (farm), industry 8+5+5=18', s[1].linkVP===2&&s[1].industryVP===18, JSON.stringify(s[1]));
  check('game over, VP added', g.gameOver && g.players[1].vp===20);
}
// Flip on last coal cube (rail link consumption) + income jump in SPACES
{ const g=fresh(); g.era=E.ERA.RAIL; const L=new E.GameLogic(g);
  put(g,'coventry_1',1,'coalMine',2,false,1); g.players[1].incomeSpace=10;
  g.players[0].hand=[{type:'location',location:'coventry'}];
  g.boardLinks['birmingham-oxford']={playerId:0,type:'rail'};
  const r=L.executeNetwork(0,'birmingham-coventry',0);
  const t=g.boardIndustries['coventry_1'];
  check('coal mine flips when last cube taken', r.success&&t.flipped&&t.resourceCubes===0);
  check('income +7 spaces: space 17 => level 4', g.players[1].incomeSpace===17&&g.getIncomeLevel(1)===4);
}
// Income track mapping & loan
{ const g=fresh(); const p=g.players[0];
  const cases=[[0,-10],[10,0],[12,1],[30,10],[33,11],[60,20],[64,21],[96,29],[99,30]];
  check('income level by space', cases.every(([s,l])=>{p.incomeSpace=s;return g.getIncomeLevel(0)===l;}));
  p.incomeSpace=99; g.advanceIncomeSpaces(0,10); check('cannot exceed level 30', g.getIncomeLevel(0)===30);
  p.incomeSpace=17; g.applyLoanIncomeDrop(0); check('loan: level 4 -> 1, top space 12', p.incomeSpace===12);
  p.incomeSpace=2; check('loan blocked below -10', !g.canTakeLoan(0));
}
// Sell: flip + income + merchant bonus; merchant not accepting type => cannot sell
{ const g=fresh(); const L=new E.GameLogic(g);
  g.merchantTiles=[{location:'oxford',buys:'cottonMill',hasBeer:true},{location:'oxford',buys:'blank',hasBeer:false}];
  put(g,'birmingham_0',0,'cottonMill',1,false);
  g.boardLinks['birmingham-oxford']={playerId:0,type:'canal'};
  g.players[0].hand=[{type:'location',location:'leek'}];
  check('cotton sellable to cotton merchant', L.getValidSellTargets(0).length===1);
  const r=L.executeSell(0,[{key:'birmingham_0',useMerchantBeer:true}],0);
  check('sell flips, +5 income spaces, +2 Oxford bonus spaces', r.success&&g.boardIndustries['birmingham_0'].flipped&&g.players[0].incomeSpace===17, 'space '+g.players[0].incomeSpace);
  put(g,'birmingham_1',0,'manufacturer',1,false);
  check('manufacturer cannot sell to cotton-only merchant', !L.getValidSellTargets(0).some(t=>t.key==='birmingham_1'));
}
// Sell multi-tile: merchant beer + bonus must not be wasted on a tile that then cannot sell
{ const g=fresh(); const L=new E.GameLogic(g);
  g.merchantTiles=[{location:'oxford',buys:'any',hasBeer:true},{location:'oxford',buys:'any',hasBeer:true}];
  put(g,'birmingham_0',0,'manufacturer',5,false); // needs 2 beer
  put(g,'birmingham_3',0,'manufacturer',5,false);
  g.boardLinks['birmingham-oxford']={playerId:0,type:'canal'};
  g.players[0].hand=[{type:'location',location:'leek'}];
  // no breweries: each tile needs 2 beer, only 2 merchant barrels exist; 2nd tile must not take a barrel w/o selling
  const before=g.players[0].incomeSpace;
  const r=L.executeSell(0,[{key:'birmingham_0',useMerchantBeer:true},{key:'birmingham_3',useMerchantBeer:true}],0);
  check('no tile sold without full beer, no free merchant bonus', !r.success && g.merchantTiles.every(m=>m.hasBeer) && g.players[0].incomeSpace===before, JSON.stringify(r));
}
// Brewery: 1 beer canal / 2 rail; flips on last beer consumed
{ for (const era of ['canal','rail']) { const g=fresh(); g.era=era; const L=new E.GameLogic(g);
    g.players[0].hand=[{type:'location',location:'stafford'}]; if(era==='rail') g.players[0].industryTiles.brewery.forEach(t=>{if(t.level===1)t.used=true;});
    const t=L.getValidBuildTargets(0).find(t=>t.cityId==='stafford'&&t.industryType==='brewery');
    if (!t) { check('brewery target '+era,false); continue; }
    L.executeBuild(0,'stafford',t.slotIndex,'brewery',0);
    check(`brewery built in ${era} has ${era==='rail'?2:1} beer`, g.boardIndustries['stafford_'+t.slotIndex].resourceCubes===(era==='rail'?2:1));
  }
  const g=fresh(); put(g,'stafford_0',1,'brewery',2,false,1); g.consumeResource('stafford_0');
  check('brewery flips when last beer taken, +5 spaces', g.boardIndustries['stafford_0'].flipped && g.players[1].incomeSpace===15);
}
// Develop: pottery L2 then lightbulb L3 in one action is illegal
{ const g=fresh(); const L=new E.GameLogic(g);
  g.players[0].industryTiles.pottery[0].used=true; // next = L2
  g.players[0].hand=[{type:'location',location:'leek'}];
  const r=L.executeDevelop(0,'pottery','pottery',0);
  check('cannot develop pottery L2 + lightbulb L3', !r.success && g.players[0].industryTiles.pottery[1].used===false, JSON.stringify(r));
  const r2=L.executeDevelop(0,'pottery',null,0);
  check('single develop of pottery L2 ok', r2.success);
}
// Overbuild rules
{ const g=fresh(); g.era=E.ERA.RAIL; const L=new E.GameLogic(g);
  put(g,'dudley_0',1,'coalMine',2,false,1);
  g.players[0].industryTiles.coalMine.forEach(t=>{ if(t.level<3) t.used=true; });
  g.players[0].hand=[{type:'location',location:'dudley'}];
  const has=()=>L.getValidBuildTargets(0).some(t=>t.cityId==='dudley'&&t.slotIndex===0);
  check('cannot overbuild opponent coal mine while coal remains', !has());
  g.boardIndustries['dudley_0'].resourceCubes=0; g.boardIndustries['dudley_0'].flipped=true; g.coalMarket=0;
  check('can overbuild opponent coal mine when no coal anywhere', has());
  put(g,'dudley_1',1,'ironWorks',1,true);
  check('never overbuild opponent iron with same level / or non-coal/iron', !L.getValidBuildTargets(0).some(t=>t.cityId==='dudley'&&t.slotIndex===1&&t.industryType!=='ironWorks'));
}
// Canal: one tile per location per player; rail: multiple; level-1 not buildable in rail
{ const g=fresh(); const L=new E.GameLogic(g);
  put(g,'birmingham_0',0,'cottonMill',1,false);
  g.players[0].hand=[{type:'location',location:'birmingham'}];
  check('canal: no 2nd own tile in same location', !L.getValidBuildTargets(0).some(t=>t.cityId==='birmingham'&&t.slotIndex!==0));
  g.era=E.ERA.RAIL; g.players[0].industryTiles.cottonMill[1].used=true; g.players[0].industryTiles.cottonMill[2].used=true;
  g.players[0].industryTiles.cottonMill[0].used=false;
  check('rail: level-1 cotton not buildable', !L.getValidBuildTargets(0).some(t=>t.industryType==='cottonMill'));
}
// Shortfall with no tiles: lose 1 VP per £1, not below 0
{ const g=fresh(); g.players[0].incomeSpace=5; g.players[0].money=2; g.players[0].vp=1;
  g.players.forEach(p=>p.hand=[{}]); g.endRound();
  check('shortfall VP loss capped at available VP, money 0', g.players[0].vp===0&&g.players[0].money===0);
}
// No income at end of final rail round
{ const g=fresh(); g.era=E.ERA.RAIL; g.drawDeck=[]; g.players.forEach(p=>{p.hand=[];p.incomeSpace=30;});
  const r=g.endRound(); check('final round: no income, endGame', r==='endGame'&&g.players[0].money===17);
}
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
