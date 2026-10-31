'use strict';
const E = require('../server/engine');
const I = (()=>{try{const vm=require('vm'),fs=require('fs');const win={localStorage:{getItem:()=> 'zh',setItem(){}}};const ctx={window:win,localStorage:win.localStorage,document:{readyState:'complete',addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,body:null,documentElement:{lang:''}},navigator:{language:'zh-TW'},MutationObserver:class{observe(){}}};ctx.window.document=ctx.document;vm.createContext(ctx);try{vm.runInContext(fs.readFileSync(__dirname+'/../js/i18n.js','utf8'),ctx);}catch(e){}return win.I18N?{translate:win.I18N.t}:null;}catch(e){return null;}})();
let pass=0, fail=0;
const check=(n,c,x='')=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+' '+x);};
function fresh(){ const g=new E.GameState(2,['A','B']); g.boardIndustries={}; g.boardLinks={}; g.breweryFarmTiles={}; g.players.forEach(p=>{p.hand=[{type:'wild_location'},{},{}];p.money=50;}); return g; }
const T = n => Object.keys(fresh().players[0].industryTiles).find(k=>k.toLowerCase().includes(n));
const COAL=T('coal'), IRON=T('iron');
const build=(g,city,type)=>{const L=new E.GameLogic(g);return L.executeBuild(0,city,0,type,0);};
const tile=(g,city)=>g.boardIndustries[city+'_0'];

// 1 coal connected, free market
{ const g=fresh(); g.boardLinks['birmingham-oxford']={playerId:1,type:'canal'}; g.coalMarket=10; // 4 empty: 4,4? spaces priced
  const inc=g.players[0].incomeSpace, m=g.players[0].money;
  const r=build(g,'birmingham',COAL); const t=tile(g,'birmingham');
  console.log('  ',r.message);
  check('coal connected: all cubes to market', t.resourceCubes===0 && g.coalMarket===10+t.tileData.resourceCubes);
  check('coal connected: tile flipped + income advanced', t.flipped && g.players[0].incomeSpace===inc+t.tileData.income, `inc ${inc}->${g.players[0].incomeSpace}`);
  check('coal connected: paid most expensive empty spaces (10/14 cubes: empty £1,£1,£2,£2 → 2+2)', g.players[0].money===m-t.tileData.cost+4, 'money '+g.players[0].money);
  check('message mentions auto-sold coal', /auto-sold 2 coal to market for £4/.test(r.message) && /tile flipped! \+\d+ income/.test(r.message));
}
// 2 coal not connected
{ const g=fresh(); g.coalMarket=10; const r=build(g,'birmingham',COAL); const t=tile(g,'birmingham');
  check('coal unconnected: cubes stay', t.resourceCubes===t.tileData.resourceCubes && !t.flipped && g.coalMarket===10);
  check('coal unconnected: message explains', /not connected to a merchant/.test(r.message), r.message);
}
// 3 iron, no connection needed
{ const g=fresh(); g.ironMarket=6; g.boardIndustries['dudley_0']={playerId:0,type:COAL,tileData:{...g.players[0].industryTiles[COAL][0]},flipped:false,resourceCubes:2};
  g.boardLinks['birmingham-dudley']={playerId:0,type:'canal'};
  const inc=g.players[0].incomeSpace; const r=build(g,'birmingham',IRON); const t=tile(g,'birmingham');
  console.log('  ',r.message);
  check('iron: cubes sold w/o merchant', r.success && t.resourceCubes===0 && t.flipped && g.ironMarket===6+t.tileData.resourceCubes, r.message);
  check('iron: income advanced', g.players[0].incomeSpace===inc+t.tileData.income);
}
// 4 partial fill
{ const g=fresh(); g.ironMarket=9; g.boardIndustries['dudley_0']={playerId:0,type:COAL,tileData:{...g.players[0].industryTiles[COAL][0]},flipped:false,resourceCubes:2};
  g.boardLinks['birmingham-dudley']={playerId:0,type:'canal'};
  const r=build(g,'birmingham',IRON); const t=tile(g,'birmingham');
  check('partial: 1 sold, rest stays, not flipped', g.ironMarket===10 && t.resourceCubes===t.tileData.resourceCubes-1 && !t.flipped, r.message);
  check('partial: message shows left on tile', /auto-sold 1 iron .*left on tile/.test(r.message));
}
// 5 Chinese translation
if (I && (I.translateMessage||I.tr||I.translate)) {
  const f=I.translateMessage||I.tr||I.translate;
  const z=f('Built Coal Mine Level 1 in Birmingham — auto-sold 2 coal to market for £8 (tile flipped! +4 income)');
  console.log('  ',z); check('zh: 煤礦自動賣出 2 塊煤', /煤礦自動賣出 2 塊煤到市場，獲得 £8（板塊翻面！收入 \+4）/.test(z));
} else console.log('  (i18n not requireable; skipped)');
console.log(`\n${pass} passed, ${fail} failed`); if(fail) process.exit(1);
