'use strict';
const E = require('../server/engine');
let pass=0, fail=0;
const check=(n,c,x='')=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+' '+x);};
function tileOf(g, type, level){ const t=g.players[0].industryTiles[type].find(t=>t.level===level); return {...t}; }
function fresh(){ const g=new E.GameState(2,['A','B']); g.boardIndustries={}; g.boardLinks={}; g.breweryFarmTiles={}; return g; }
const T = n => Object.keys(fresh().players[0].industryTiles).find(k=>k.toLowerCase().includes(n));
const COTTON=T('cotton'), COAL=T('coal'), POT=T('pott');

// 1. Canal scoring: link to merchant (2 icons) + flipped L1 cotton (1 icon, 5VP)
{ const g=fresh();
  g.boardIndustries['birmingham_0']={playerId:1,type:COTTON,tileData:tileOf(g,COTTON,1),flipped:true,resourceCubes:0};
  g.boardIndustries['birmingham_1']={playerId:1,type:COAL,tileData:tileOf(g,COAL,2),flipped:false,resourceCubes:1}; // unflipped: 0
  g.boardLinks['birmingham-oxford']={playerId:0,type:'canal'};
  const s=g.endCanalEra();
  check('canal link VP = 1 (cotton) + 2 (Oxford merchant)', s[0].linkVP===3, JSON.stringify(s[0]));
  check('flipped cotton L1 scores 5, unflipped coal L2 scores 0', s[1].industryVP===5, JSON.stringify(s[1]));
  check('L1 removed, L2 kept, canal links removed', !g.boardIndustries['birmingham_0'] && !!g.boardIndustries['birmingham_1'] && Object.keys(g.boardLinks).length===0);
  check('VP not money: money unchanged by scoring', g.players[0].money===17);
}
// 2. Rail coal sourcing: closest mine across both ends of link
{ const g=fresh(); g.era=E.ERA.RAIL;
  g.boardIndustries['dudley_0']={playerId:1,type:COAL,tileData:tileOf(g,COAL,2),flipped:false,resourceCubes:1};
  g.boardIndustries['coventry_0']={playerId:1,type:COAL,tileData:tileOf(g,COAL,2),flipped:false,resourceCubes:1};
  g.boardLinks['birmingham-dudley']={playerId:0,type:'rail'};
  const L=new E.GameLogic(g);
  const src=L.findCheapestCoalForLink({id:'birmingham-coventry',cities:['birmingham','coventry']},0);
  check('rail link birmingham-coventry uses closest mine (coventry, 0 links) not dudley (1 link)', src.key==='coventry_0', 'got '+src.key);
}
// 3. Income/turn order/shortfall
{ const g=fresh(); g.players[0].incomeSpace=7; g.players[0].money=1; // level -3
  g.boardIndustries['leek_0']={playerId:0,type:COTTON,tileData:tileOf(g,COTTON,1),flipped:false,resourceCubes:0};
  g.players.forEach(p=>p.hand=[{}]); g.turnOrder=[0,1]; g.moneySpentThisRound={0:10,1:3};
  g.endRound();
  check('shortfall: sold cotton L1 (cost12 -> £6), money 1-3+6=4', g.players[0].money===4 && !g.boardIndustries['leek_0'], 'money '+g.players[0].money);
  check('turn order least-spent first', g.turnOrder[0]===1);
}
// 2b. Equal-distance mines: acting player may choose via coalKey; default deterministic
{ const g=fresh(); g.era=E.ERA.RAIL;
  g.boardIndustries['birmingham_0']={playerId:1,type:COAL,tileData:tileOf(g,COAL,2),flipped:false,resourceCubes:1};
  g.boardIndustries['coventry_0']={playerId:0,type:COAL,tileData:tileOf(g,COAL,2),flipped:false,resourceCubes:1};
  const L=new E.GameLogic(g); const conn={id:'birmingham-coventry',cities:['birmingham','coventry']};
  const opts=L.getCoalMineOptionsForLink(conn,0).map(o=>o.key).sort();
  check('tied mines both offered', opts.join()==='birmingham_0,coventry_0', opts.join());
  check('default tie pick is first link end', L.findCheapestCoalForLink(conn,0).key==='birmingham_0');
  check('player choice honoured on tie', L.findCheapestCoalForLink(conn,0,'coventry_0').key==='coventry_0');
  check('choice of a farther mine is ignored', (()=>{ g.boardIndustries['coventry_0'].resourceCubes=0;
    g.boardIndustries['dudley_0']={playerId:0,type:COAL,tileData:tileOf(g,COAL,2),flipped:false,resourceCubes:1}; g.boardLinks['birmingham-dudley']={playerId:0,type:'rail'};
    return L.findCheapestCoalForLink(conn,0,'dudley_0').key==='birmingham_0'; })());
}
// 2c. No connected mine -> market (merchant connection needed)
{ const g=fresh(); g.era=E.ERA.RAIL; const L=new E.GameLogic(g);
  const s=L.findCheapestCoalForLink({id:'birmingham-oxford',cities:['birmingham','oxford']},0);
  check('no mine -> market coal', s && s.type==='market', JSON.stringify(s));
}
// 4. Pass is ONE action: with 2 actions the player keeps the turn
{ const { Room } = require('../server/rooms');
  const r=Room.create([{name:'A'},{name:'B'}]); r.scheduleAI=()=>{}; r.broadcast=()=>{};
  r.state.isFirstRound=false; r.state.actionsPerTurn=2; r.state.actionsThisTurn=0;
  const p=r.state.currentPlayerId, h=r.state.players[p].hand.length;
  const res=r.handleAction(p,{action:'pass',cardIndex:0});
  check('pass consumes one action, same player continues', res.success && r.state.currentPlayerId===p && r.state.actionsThisTurn===1 && r.state.players[p].hand.length===h-1);
  r.handleAction(p,{action:'pass',cardIndex:0});
  check('second pass ends the turn', r.state.currentPlayerId!==p);
  check('log announces next turn', /turn/.test(r.log[r.log.length-1].message));
}
// 5. '輪到 X' is logged at the start of EVERY turn, even when the same player goes again
{ const { Room } = require('../server/rooms');
  const r=Room.create([{name:'A'},{name:'B'}]); r.scheduleAI=()=>{}; r.broadcast=()=>{};
  const cur=()=>r.state.currentPlayerId; const pass1=()=>r.handleAction(cur(),{action:'pass',cardIndex:0});
  pass1(); pass1(); // round 1 (1 action each)
  const first=cur(); pass1(); pass1(); // first player's 2 actions in round 2
  const last=cur(); r.state.moneySpentThisRound={[first]:10,[last]:0};
  pass1(); const nLog=r.log.length; pass1(); // round ends; 'last' spent least -> goes first again
  const msgs=r.log.slice(nLog).map(l=>l.message);
  check('same player starting new round gets a turn log line', cur()===last && msgs.includes(r.state.players[last].name+"'s turn"), JSON.stringify(msgs));
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
