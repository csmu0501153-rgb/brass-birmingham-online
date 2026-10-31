// ============================================================================
// Brass: Birmingham Online - Main Entry Point
// No room in the URL  -> room creation screen.
// ?room=ID&token=SECRET -> connect to the server as that seat.
// ============================================================================

let boardRenderer = null;
let uiManager = null;
let netClient = null;

// ============================================================================
// Room creation screen
// ============================================================================

function initSetup() {
    let playerCount = 3;

    document.querySelectorAll('.count-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            playerCount = parseInt(btn.dataset.count);
            renderSeatInputs(playerCount);
        });
    });
    renderSeatInputs(playerCount);

    document.getElementById('start-game-btn').addEventListener('click', async () => {
        const seats = [];
        document.querySelectorAll('.player-name-input').forEach(row => {
            const input = row.querySelector('input[type="text"]');
            const kind = row.querySelector('.seat-kind-select').value;
            seats.push({
                name: input.value.trim() || input.placeholder,
                isAI: kind !== 'human',
                difficulty: kind === 'human' ? 'normal' : kind,
            });
        });
        if (!seats.some(s => !s.isAI)) {
            showSetupError('At least one seat must be a human player');
            return;
        }
        const btn = document.getElementById('start-game-btn');
        btn.disabled = true;
        try {
            const res = await fetch('api/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seats }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not create room');
            showRoomLinks(data);
        } catch (e) {
            showSetupError(e.message || 'Could not create room');
        } finally {
            btn.disabled = false;
        }
    });
}

function showSetupError(msg) {
    const el = document.getElementById('setup-error');
    el.textContent = msg;
    el.classList.remove('hidden');
}

function renderSeatInputs(count) {
    const container = document.querySelector('.player-name-inputs');
    container.innerHTML = '';
    const defaultNames = ['Alice', 'Bob', 'Carol', 'Dave'];
    for (let i = 0; i < count; i++) {
        const div = document.createElement('div');
        div.className = 'player-name-input';
        div.innerHTML = `
            <div class="color-swatch" style="background: ${PLAYER_COLORS[i]}"></div>
            <input type="text" placeholder="${defaultNames[i]}" maxlength="20">
            <select class="seat-kind-select">
                <option value="human" selected>Human</option>
                <option value="easy">AI (Easy)</option>
                <option value="normal">AI (Normal)</option>
                <option value="hard">AI (Hard)</option>
            </select>
        `;
        container.appendChild(div);
    }
}

function showRoomLinks(data) {
    document.querySelector('.setup-form').classList.add('hidden');
    const panel = document.getElementById('room-links');
    const list = document.getElementById('room-links-list');
    list.innerHTML = '';
    data.seats.forEach(seat => {
        const row = document.createElement('div');
        row.className = 'room-link-row';
        const color = PLAYER_COLORS[seat.seat];
        if (seat.isAI) {
            row.innerHTML = `<div class="color-swatch" style="background:${color}"></div>
                <span class="room-link-name"></span>
                <span class="room-link-ai">AI player (played by the server)</span>`;
        } else {
            row.innerHTML = `<div class="color-swatch" style="background:${color}"></div>
                <span class="room-link-name"></span>
                <input class="room-link-url" type="text" readonly>
                <button class="room-link-copy btn-small">Copy</button>
                <a class="room-link-open btn-small" target="_blank" rel="noopener">Open</a>`;
            const input = row.querySelector('.room-link-url');
            input.value = seat.url;
            input.addEventListener('focus', () => input.select());
            row.querySelector('.room-link-open').href = seat.url;
            row.querySelector('.room-link-copy').addEventListener('click', async (e) => {
                const ok = await copyText(seat.url, input);
                e.target.textContent = ok ? 'Copied!' : 'Copy';
                setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
            });
        }
        row.querySelector('.room-link-name').textContent = seat.name;
        list.appendChild(row);
    });
    panel.classList.remove('hidden');
}

async function copyText(text, input) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (_) {
        input.focus();
        input.select();
        try { return document.execCommand('copy'); } catch (__) { return false; }
    }
}

// ============================================================================
// Network client (WebSocket, auto-reconnect with the same token)
// ============================================================================

class NetClient {
    constructor(roomId, token, handlers) {
        this.roomId = roomId;
        this.token = token;
        this.handlers = handlers;
        this.ws = null;
        this.retry = 0;
        this.fatal = false;
        this.timer = null;
    }

    connect() {
        if (this.fatal) return;
        clearTimeout(this.timer);
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const base = location.pathname.replace(/[^/]*$/, '');
        const url = `${proto}://${location.host}${base}ws?room=${encodeURIComponent(this.roomId)}&token=${encodeURIComponent(this.token)}`;
        this.handlers.status('connecting');
        let ws;
        try { ws = new WebSocket(url); } catch (_) { return this.scheduleReconnect(); }
        this.ws = ws;
        ws.onopen = () => { this.retry = 0; this.handlers.status('online'); };
        ws.onmessage = (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch (_) { return; }
            if (msg.type === 'error' && msg.fatal) {
                this.fatal = true;
                this.handlers.status('fatal', msg.message);
                return;
            }
            this.handlers.message(msg);
        };
        ws.onclose = () => {
            if (this.ws !== ws) return;
            this.ws = null;
            if (this.fatal) return;
            this.handlers.status('offline');
            this.scheduleReconnect();
        };
        ws.onerror = () => { /* onclose follows */ };
    }

    scheduleReconnect() {
        clearTimeout(this.timer);
        const delay = Math.min(10000, 1000 * Math.pow(1.6, this.retry++));
        this.timer = setTimeout(() => this.connect(), delay);
    }

    reconnectNow() {
        if (!this.ws && !this.fatal) { this.retry = 0; this.connect(); }
    }

    send(obj) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
        this.ws.send(JSON.stringify(obj));
        return true;
    }
}

function setNetStatus(kind, message) {
    const el = document.getElementById('net-status');
    if (!el) return;
    el.className = `net-status net-${kind}`;
    el.textContent = {
        connecting: 'Connecting…',
        online: 'Online',
        offline: 'Disconnected — reconnecting…',
        fatal: message || 'Invalid room link',
    }[kind] || '';
    if (kind === 'fatal') {
        const err = document.getElementById('fatal-error');
        err.querySelector('.fatal-error-msg').textContent = message || 'Invalid room link';
        err.classList.remove('hidden');
    }
}

function startOnline(roomId, token) {
    document.getElementById('setup-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    netClient = new NetClient(roomId, token, {
        status: setNetStatus,
        message: (msg) => {
            if (msg.type === 'state') {
                if (!uiManager) {
                    const st = Object.assign(Object.create(GameState.prototype), msg.view);
                    const svg = document.getElementById('game-board');
                    boardRenderer = new BoardRenderer(svg);
                    boardRenderer.render(st);
                    uiManager = new UIManager();
                    uiManager.init(st, new GameLogic(st), boardRenderer, { net: netClient, myId: msg.you });
                    window.uiManager = uiManager;
                }
                uiManager.applyServerState(msg);
                document.title = `Brass: Birmingham — ${msg.seats[msg.you].name}`;
            } else if (msg.type === 'result') {
                if (uiManager) uiManager.onServerResult(msg);
            } else if (msg.type === 'error') {
                if (uiManager) uiManager.showToast(msg.message, 'error');
            }
        },
    });
    netClient.connect();

    // Re-sync quickly when the tab/phone wakes up
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') netClient.reconnectNow();
    });
    window.addEventListener('online', () => netClient.reconnectNow());
}

// ============================================================================
// Initialize
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    const token = params.get('token');
    if (room && token) startOnline(room, token);
    else initSetup();
});
