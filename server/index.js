// HTTP (static client + JSON API) and WebSocket server for online Brass: Birmingham.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room, RoomStore, send } = require('./rooms');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SAVE_INTERVAL_MS = Number(process.env.SAVE_INTERVAL_MS || 30000);

const store = new RoomStore(DATA_DIR);
const loaded = store.loadAll();
console.log(`Loaded ${loaded} room(s) from ${DATA_DIR}`);

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const PUBLIC_DIRS = ['js', 'css', 'assets'];

function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
}

function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath);
    if (rel === '/' || rel === '') rel = '/index.html';
    const full = path.normalize(path.join(ROOT, rel));
    const relToRoot = path.relative(ROOT, full);
    const top = relToRoot.split(path.sep)[0];
    const allowed = relToRoot === 'index.html' || PUBLIC_DIRS.includes(top);
    if (!allowed || relToRoot.startsWith('..')) { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(full, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': rel === '/index.html' ? 'no-cache' : 'public, max-age=300' });
        res.end(buf);
    });
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return json(res, 200, { ok: true, rooms: store.rooms.size, uptime: process.uptime() });
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
        let body = '';
        req.on('data', d => { body += d; if (body.length > 10000) req.destroy(); });
        req.on('end', () => {
            try {
                const spec = JSON.parse(body || '{}');
                const room = Room.create(Array.isArray(spec.seats) ? spec.seats : []);
                store.add(room);
                room.scheduleAI();
                const base = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
                json(res, 200, {
                    roomId: room.id,
                    seats: room.seats.map((s, i) => ({
                        seat: i, name: s.name, isAI: s.isAI, difficulty: s.difficulty,
                        url: s.token ? `${base}/?room=${room.id}&token=${s.token}` : null,
                    })),
                });
            } catch (e) { json(res, 400, { error: e.message }); }
        });
        return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url.pathname);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const room = store.rooms.get(url.searchParams.get('room') || '');
    const seat = room ? room.seatForToken(url.searchParams.get('token')) : -1;
    if (!room || seat < 0) {
        send(ws, { type: 'error', fatal: true, message: 'Invalid room link' });
        return ws.close(4001, 'invalid');
    }
    const client = { ws, seat };
    room.clients.add(client);
    room.broadcast(); // includes the new client + updated "connected" flags
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', data => {
        let msg;
        try { msg = JSON.parse(String(data)); } catch (_) { return send(ws, { type: 'error', message: 'Bad message' }); }
        if (msg.type === 'ping') return send(ws, { type: 'pong' });
        let res;
        if (msg.type === 'action') res = room.handleAction(seat, msg);
        else if (msg.type === 'bonus') res = room.handleBonus(seat, msg.industryType || null);
        else if (msg.type === 'sync') return send(ws, room.viewFor(seat));
        else res = { success: false, message: 'Unknown message' };
        send(ws, { type: 'result', ok: res.success, message: res.message, requestId: msg.requestId });
        if (!res.success) send(ws, room.viewFor(seat));
    });
    ws.on('close', () => { room.clients.delete(client); room.broadcast(); });
});

// Keep-alive pings (also count as traffic for proxies)
const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch (_) { /* ignore */ }
    }
}, 30000);

const saveTimer = setInterval(() => store.saveAll(), SAVE_INTERVAL_MS);

function shutdown() {
    clearInterval(pingTimer); clearInterval(saveTimer);
    store.saveAll();
    for (const r of store.rooms.values()) r.dispose();
    wss.close(); server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`Brass online server on :${PORT}`));
module.exports = { server, store };
