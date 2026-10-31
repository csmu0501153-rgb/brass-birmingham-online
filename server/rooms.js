// Server-authoritative rooms: full game state, rule enforcement, AI, per-player views.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const E = require('./engine');

const AI_DELAY_MS = Number(process.env.AI_DELAY_MS || 1200);
const MAX_LOG = 200;
const rid = (n) => crypto.randomBytes(n).toString('hex');

class Room {
    constructor(data) {
        this.id = data.id;
        this.createdAt = data.createdAt || Date.now();
        this.seats = data.seats;              // [{name, isAI, difficulty, token}]
        this.log = data.log || [];
        this.pendingBonus = data.pendingBonus || null; // {seat, count}
        this.event = data.event || null;      // {seq, type:'scoring'|'gameover', title, scores}
        this.rev = data.rev || 0;
        this.state = E.restoreState(data.state);
        this.logic = new E.GameLogic(this.state);
        this.clients = new Set();             // {ws, seat}
        this.aiTimer = null;
        this.dirty = false;
        this.onChange = null;
    }

    static create(seatSpecs) {
        const n = seatSpecs.length;
        if (n < 2 || n > 4) throw new Error('Players must be 2-4');
        const seats = seatSpecs.map((s, i) => {
            const isAI = !!s.isAI;
            const difficulty = ['easy', 'normal', 'hard'].includes(s.difficulty) ? s.difficulty : 'normal';
            const name = String(s.name || '').trim().slice(0, 20) || (isAI ? `AI ${i + 1}` : `Player ${i + 1}`);
            return { name, isAI, difficulty, token: isAI ? null : rid(16) };
        });
        if (!seats.some(s => !s.isAI)) throw new Error('At least one human seat is required');
        const st = new E.GameState(n, seats.map(s => s.name), seats.map(s => ({ isAI: s.isAI, difficulty: s.difficulty })));
        const room = new Room({ id: rid(6), seats, state: E.dumpState(st) });
        room.tagCards();
        room.addLog(null, `Game started with ${n} players`, 'system');
        room.addLog(null, 'Canal Era', 'era');
        room.addLog(null, `${room.state.currentPlayer.name}'s turn`, 'system');
        return room;
    }

    // Every real card gets an unguessable uid (used by tests to prove no leaks).
    tagCards() {
        const tag = c => { if (c && !c.uid) c.uid = rid(6); };
        this.state.drawDeck.forEach(tag);
        this.state.players.forEach(p => p.hand.forEach(tag));
    }

    addLog(playerId, message, type = 'action') {
        this.log.push({ playerId, message, type, t: Date.now() });
        if (this.log.length > MAX_LOG) this.log.shift();
    }

    seatForToken(token) {
        if (typeof token !== 'string') return -1;
        return this.seats.findIndex(s => s.token && s.token.length === token.length &&
            crypto.timingSafeEqual(Buffer.from(s.token), Buffer.from(token)));
    }

    toJSON() {
        return {
            id: this.id, createdAt: this.createdAt, seats: this.seats, log: this.log,
            pendingBonus: this.pendingBonus, event: this.event, rev: this.rev,
            state: E.dumpState(this.state),
        };
    }

    // ---- Per-player view: public info + ONLY this seat's hand -------------
    viewFor(seat) {
        const v = JSON.parse(E.dumpState(this.state));
        v.players.forEach(p => {
            if (p.id !== seat) p.hand = p.hand.map(() => ({ type: 'hidden' }));
        });
        v.drawDeck = v.drawDeck.map(() => ({ type: 'hidden' }));
        v.selectedCardIndex = null; v.pendingAction = null; v.selectedAction = null;
        const msg = {
            type: 'state', rev: this.rev, roomId: this.id, you: seat,
            seats: this.seats.map(s => ({ name: s.name, isAI: s.isAI, difficulty: s.difficulty })),
            connected: this.seats.map((_, i) => [...this.clients].some(c => c.seat === i)),
            view: v, log: this.log.slice(-100), event: this.event,
            pendingBonus: null,
        };
        if (this.pendingBonus && this.pendingBonus.seat === seat) {
            msg.pendingBonus = {
                count: this.pendingBonus.count,
                types: this.logic.getDevelopableTypes(seat).map(t => ({ type: t.type, level: t.level })),
            };
        }
        return msg;
    }

    broadcast() {
        for (const c of this.clients) send(c.ws, this.viewFor(c.seat));
    }

    changed() {
        this.rev++;
        this.dirty = true;
        if (this.onChange) this.onChange(this);
        this.broadcast();
        this.scheduleAI();
    }

    // ---- Actions ----------------------------------------------------------
    // msg: {action, pendingData, cardIndex, scoutCards}
    handleAction(seat, msg) {
        const st = this.state;
        if (st.gameOver) return fail('Game is over');
        if (this.pendingBonus) return fail('Waiting for merchant bonus choice');
        if (st.currentPlayerId !== seat) return fail('Not your turn');
        const res = this.applyAction(seat, msg, false);
        if (res.success) this.changed();
        return res;
    }

    handleBonus(seat, industryType) {
        if (!this.pendingBonus || this.pendingBonus.seat !== seat) return fail('No bonus pending');
        if (industryType) {
            const ok = this.logic.getDevelopableTypes(seat).some(t => t.type === industryType);
            if (!ok) return fail('Cannot develop that industry');
            const removed = this.logic.applyFreeDevelop(seat, 1, industryType);
            if (removed.length) this.addLog(seat, `used merchant bonus: developed ${removed[0]}`);
            this.pendingBonus.count--;
            if (this.pendingBonus.count > 0 && this.logic.getDevelopableTypes(seat).length > 0) {
                this.changed();
                return { success: true, message: 'Bonus applied' };
            }
        }
        this.pendingBonus = null;
        this.finishAction();
        this.changed();
        return { success: true, message: 'Bonus resolved' };
    }

    applyAction(seat, msg, isAI) {
        const snapshot = E.dumpState(this.state);
        let res;
        try {
            res = this.execute(seat, msg || {}, isAI);
        } catch (e) {
            res = fail('Invalid action');
        }
        if (!res.success) {
            // Roll back any partial mutation
            this.state = E.restoreState(snapshot);
            this.logic = new E.GameLogic(this.state);
            return res;
        }
        this.addLog(seat, logLine(msg.action, res));
        if (res.pendingDevelopBonuses > 0 && !isAI &&
            this.logic.getDevelopableTypes(seat).length > 0) {
            this.pendingBonus = { seat, count: res.pendingDevelopBonuses };
            return res; // turn continues after the bonus choice
        }
        this.finishAction();
        return res;
    }

    execute(p, msg, isAI) {
        const L = this.logic, A = E.ACTIONS;
        const hand = this.state.players[p].hand;
        const pd = msg.pendingData || {};
        const ci = msg.cardIndex;
        const cardOk = (action, target) =>
            Number.isInteger(ci) && ci >= 0 && ci < hand.length &&
            L.getValidCardsForAction(p, action, target).includes(ci);

        if (!Object.values(A).includes(msg.action)) return fail('Unknown action');
        if (msg.action !== A.PASS && msg.action !== A.SCOUT && !L.canPerformAction(msg.action, p))
            return fail(L.getDisabledReason(msg.action, p) || 'Action not allowed');

        switch (msg.action) {
            case A.BUILD: {
                const t = L.getValidBuildTargets(p).find(t =>
                    t.cityId === pd.cityId && t.slotIndex === pd.slotIndex && t.industryType === pd.industryType);
                if (!t) return fail('Invalid build target');
                const target = { cityId: t.cityId, slotIndex: t.slotIndex, industryType: t.industryType };
                if (!cardOk(A.BUILD, target)) return fail('That card cannot be used for this build');
                return L.executeBuild(p, t.cityId, t.slotIndex, t.industryType, ci);
            }
            case A.NETWORK: {
                if (!L.getValidNetworkTargets(p).some(t => t.connectionId === pd.connectionId))
                    return fail('Invalid connection');
                if (!cardOk(A.NETWORK)) return fail('Invalid card');
                if (pd.connectionId2) {
                    if (!L.getValidSecondRailLinks(p, pd.connectionId).some(s => s.connectionId === pd.connectionId2))
                        return fail('Invalid second link');
                    return L.executeNetworkDouble(p, pd.connectionId, pd.connectionId2, ci);
                }
                return L.executeNetwork(p, pd.connectionId, ci, typeof pd.coalKey === 'string' ? pd.coalKey : null);
            }
            case A.DEVELOP: {
                const types = L.getDevelopableTypes(p).map(t => t.type);
                if (!types.includes(pd.industryType1)) return fail('Cannot develop that industry');
                const t2 = pd.industryType2 || null;
                if (t2 && !types.includes(t2)) return fail('Cannot develop that industry');
                if (!cardOk(A.DEVELOP)) return fail('Invalid card');
                return L.executeDevelop(p, pd.industryType1, t2, ci);
            }
            case A.SELL: {
                const valid = new Set(L.getValidSellTargets(p).map(t => t.key));
                const plan = Array.isArray(pd.sellPlan) ? pd.sellPlan : [];
                const keys = plan.map(x => x && x.key);
                if (!plan.length || new Set(keys).size !== keys.length || !keys.every(k => valid.has(k)))
                    return fail('Invalid sell plan');
                if (!cardOk(A.SELL)) return fail('Invalid card');
                const clean = plan.map(x => ({ key: x.key, useMerchantBeer: !!x.useMerchantBeer }));
                return L.executeSell(p, clean, ci, { autoResolveDevelop: isAI });
            }
            case A.LOAN:
                if (!cardOk(A.LOAN)) return fail('Invalid card');
                return L.executeLoan(p, ci);
            case A.SCOUT: {
                const sc = (msg.scoutCards || pd.scoutCards);
                if (!L.canPerformAction(A.SCOUT, p)) return fail(L.getDisabledReason(A.SCOUT, p) || 'Cannot scout');
                if (!Array.isArray(sc) || sc.length !== 3 || new Set(sc).size !== 3 ||
                    !sc.every(i => Number.isInteger(i) && i >= 0 && i < hand.length))
                    return fail('Must discard exactly 3 cards');
                return L.executeScout(p, sc);
            }
            case A.PASS:
                if (!cardOk(A.PASS)) return fail('Invalid card');
                return L.executePass(p, ci);
        }
        return fail('Unknown action');
    }

    finishAction() {
        const st = this.state;
        const prev = st.currentPlayerId;
        const r = st.advanceTurn();
        for (const ev of st.lastRoundEvents || []) this.addLog(ev.playerId, ev.message);
        st.lastRoundEvents = [];
        const seq = (this.event ? this.event.seq : 0) + 1;
        if (r === 'endCanalEra') {
            this.addLog(null, 'Canal Era Scoring', 'era');
            const scores = st.endCanalEra();
            this.addLog(null, 'Rail Era', 'era');
            this.event = { seq, type: 'scoring', title: 'Canal Era Complete', scores };
        } else if (r === 'endGame') {
            this.addLog(null, 'Final Scoring', 'era');
            const scores = st.endGame();
            this.event = { seq, type: 'gameover', title: 'Game Over', scores };
            return;
        }
        this.tagCards();
        if (st.currentPlayerId !== prev || r === 'endCanalEra' || st.actionsThisTurn === 0)
            this.addLog(null, `${st.currentPlayer.name}'s turn`, 'system');
    }

    // ---- AI ---------------------------------------------------------------
    scheduleAI() {
        if (this.aiTimer || this.state.gameOver || this.pendingBonus) return;
        if (!this.seats[this.state.currentPlayerId].isAI) return;
        this.aiTimer = setTimeout(() => { this.aiTimer = null; this.runAI(); }, AI_DELAY_MS);
    }

    runAI() {
        const st = this.state;
        if (st.gameOver || this.pendingBonus) return;
        const p = st.currentPlayerId;
        const seat = this.seats[p];
        if (!seat.isAI) return;
        let res;
        try {
            const d = E.AIPlayer.chooseAction(st, this.logic, p, seat.difficulty);
            res = this.applyAction(p, {
                action: d.action, pendingData: d.pendingData || {}, cardIndex: d.cardIndex,
                // AI's pendingData.scoutCards holds 2 indices; cardIndex is the 3rd
                scoutCards: d.action === E.ACTIONS.SCOUT
                    ? [...((d.pendingData && d.pendingData.scoutCards) || []), d.cardIndex] : undefined,
            }, true);
        } catch (e) { res = fail(String(e && e.message)); }
        if (!res.success) {
            // Fallback: pass with the first card so the game never stalls
            res = this.applyAction(p, { action: E.ACTIONS.PASS, cardIndex: 0 }, true);
        }
        this.changed();
    }

    dispose() { if (this.aiTimer) clearTimeout(this.aiTimer); this.aiTimer = null; }
}

function fail(message) { return { success: false, message }; }

function logLine(action, res) {
    const A = E.ACTIONS;
    switch (action) {
        case A.LOAN: return 'took £30 loan';
        case A.SCOUT: return 'scouted (gained wild cards)';
        case A.PASS: return 'passed';
        case A.BUILD: return res.message.replace(/^Built /, 'built ');
        case A.NETWORK: return res.message.replace(/^Built /, 'built ');
        default: return res.message.charAt(0).toLowerCase() + res.message.slice(1);
    }
}

function send(ws, obj) {
    try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) { /* ignore */ }
}

// ---- Persistence ---------------------------------------------------------
class RoomStore {
    constructor(dir) {
        this.dir = dir;
        this.rooms = new Map();
        fs.mkdirSync(dir, { recursive: true });
    }
    file(id) { return path.join(this.dir, `room-${id}.json`); }
    add(room) {
        room.onChange = r => this.save(r);
        this.rooms.set(room.id, room);
        this.save(room);
    }
    save(room) {
        try {
            const f = this.file(room.id), tmp = f + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(room.toJSON()));
            fs.renameSync(tmp, f);
            room.dirty = false;
        } catch (e) { console.error('save failed', room.id, e.message); }
    }
    saveAll() { for (const r of this.rooms.values()) this.save(r); }
    loadAll() {
        for (const f of fs.readdirSync(this.dir)) {
            if (!/^room-[0-9a-f]+\.json$/.test(f)) continue;
            try {
                const room = new Room(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')));
                room.onChange = r => this.save(r);
                this.rooms.set(room.id, room);
                room.scheduleAI();
            } catch (e) { console.error('load failed', f, e.message); }
        }
        return this.rooms.size;
    }
}

module.exports = { Room, RoomStore, send };
