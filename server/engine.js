// Loads the browser game rule files (gameData/gameState/gameLogic/aiPlayer)
// unchanged into a Node vm context and exposes them.
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'js');
const FILES = ['gameData.js', 'gameState.js', 'gameLogic.js', 'aiPlayer.js'];

const ctx = vm.createContext({ console, Math, Date });
for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
}
vm.runInContext(`
function __dumpState(g) { return JSON.stringify(Object.assign({}, g)); }
function __restoreState(s) {
    const g = Object.create(GameState.prototype);
    Object.assign(g, JSON.parse(s));
    return g;
}
`, ctx, { filename: 'engine-helpers.js' });

module.exports = vm.runInContext(`({
    GameState, GameLogic, linkScoreBreakdown, AIPlayer, ACTIONS, CARD_TYPES, ERA, INDUSTRY_DISPLAY, CONNECTIONS,
    dumpState: __dumpState, restoreState: __restoreState
})`, ctx);
