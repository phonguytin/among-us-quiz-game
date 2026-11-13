import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { io as connect } from "socket.io-client";
import { registerGameEvents } from "../../backend/src/events/gameEvents.js";
import { registerRoomEvents } from "../../backend/src/events/roomEvents.js";
import { RoomsManager } from "../../backend/src/managers/rooms.manager.js";
const { Server } = createRequire(new URL("../../backend/package.json", import.meta.url))("socket.io");

const once = (socket, event) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error("Timeout: " + event)); }, 3000);
    const handler = (data) => { clearTimeout(timer); resolve(data); };
    socket.once(event, handler);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Collect every room:message each client receives. */
const inbox = (clients) => clients.map((socket) => {
    const box = [];
    socket.on("room:message", (m) => box.push(m));
    return box;
});

async function setup(t, count = 4) {
    const http = createServer();
    const server = new Server(http);
    server.on("connection", (socket) => { registerRoomEvents(server, socket); registerGameEvents(server, socket); });
    await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
    const roomId = "chat-test-" + Date.now() + "-" + Math.random();
    const clients = [];
    const ids = [];
    t.after(async () => {
        RoomsManager.meetings.end(roomId);
        clients.forEach((socket) => socket.disconnect());
        await new Promise((resolve) => server.close(resolve));
    });
    for (let i = 0; i < count; i++) {
        const socket = connect("http://127.0.0.1:" + http.address().port, { transports: ["websocket"], forceNew: true });
        clients.push(socket);
        await once(socket, "connect");
        const id = roomId + "-p" + i;
        ids.push(id);
        const registered = once(socket, "player:registered");
        socket.emit("player:register", { id, name: "Player " + i, color: "#c51111" });
        await registered;
        const joined = once(socket, "room:joined");
        socket.emit(i === 0 ? "room:create" : "room:join", i === 0 ? { hostId: id, roomId,
            questions: [
                { title: "2+2?", description: "", options: [3, 4], answer: 4, explain: "4" },
                { title: "3+3?", description: "", options: [5, 6], answer: 6, explain: "6" },
            ],
        } : { playerId: id, roomId });
        await joined;
    }
    const send = (i, message) => clients[i].timeout(2000).emitWithAck("room:send:message", { roomId, message });
    return { roomId, clients, ids, send };
}

test("lobby chat: broadcast to everyone, uses server-side identity, validates input", async (t) => {
    const { clients, ids, send } = await setup(t, 2);
    const boxes = inbox(clients);

    assert.deepEqual(await send(0, "  xin   chào  "), { ok: true });
    await wait(100);
    for (const box of boxes) {
        assert.equal(box.length, 1);
        assert.equal(box[0].message, "xin chào");
        assert.equal(box[0].playerId, ids[0]);
        assert.equal(box[0].name, "Player 0");
        assert.equal(box[0].dead, false);
    }

    assert.equal((await send(1, "   ")).ok, false);
    assert.equal((await send(1, "x".repeat(201))).ok, false);
    assert.equal((await send(0, "spam")).ok, false); // cooldown
});

test("in-game chat: alive only during meetings; dead players talk only among the dead", async (t) => {
    const { roomId, clients, ids, send } = await setup(t, 4);
    const start = once(clients[0], "game:started");
    clients[0].emit("game:start", { roomId });
    await start;
    const room = RoomsManager.fetchRoom(roomId);
    const killer = ids.indexOf(room.imposter);
    const victim = ids.findIndex((id) => id !== room.imposter);
    const alive = ids.findIndex((id, i) => id !== room.imposter && i !== victim);

    // Alive players cannot chat outside meetings
    assert.equal((await send(alive, "hi")).ok, false);

    const killed = once(clients[victim], "player:killed");
    clients[killer].emit("player:kill", { roomId, killerId: ids[killer], playerId: ids[victim] });
    await killed;
    clients[victim].emit("player:spectate", { roomId, playerId: ids[victim] });
    await wait(100);

    const boxes = inbox(clients);
    assert.deepEqual(await send(victim, "boo"), { ok: true });
    await wait(100);
    assert.equal(boxes[victim].length, 1);
    assert.equal(boxes[victim][0].dead, true);
    assert.equal(boxes[alive].length, 0);
    assert.equal(boxes[killer].length, 0);

    // During a meeting, alive players' messages reach everyone (dead included)
    const started = once(clients[alive], "meeting:started");
    clients[alive].emit("meeting:start", { roomId, callerId: ids[alive] });
    await started;
    assert.deepEqual(await send(alive, "who?"), { ok: true });
    await wait(100);
    for (const box of boxes) assert.ok(box.some((m) => m.message === "who?"));
});
