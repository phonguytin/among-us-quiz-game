import { RoomsManager } from '../managers/rooms.manager.js';
import { PlayersManager } from '../managers/players.manager.js';
import { actionState, attemptKill, attemptEmergency, attemptBodyReport, afterMeeting } from '../managers/actions.manager.js';

export const registerGameEvents = (io, socket) => {
    const reply = (room, result, acknowledge) => {
        const state = room?.actions ? actionState(room, socket.data.playerId) : undefined;
        if (state) socket.emit('game:actions', state);
        if (typeof acknowledge === 'function') acknowledge({ ...result, state });
        else if (!result.ok) socket.emit('game:notif', { message: result.error });
    };

    const broadcastState = room => {
        for (const client of io.sockets.sockets.values()) {
            if (client.rooms.has(room.id) && room.players[client.data.playerId]) {
                client.emit('game:actions', actionState(room, client.data.playerId));
            }
        }
    };

    const checkWin = roomId => {
        const win = RoomsManager.checkWin(roomId);
        if (win !== null) io.to(roomId).emit('game:ended', { roomId, isImposter: win });
    };

    const playerMove = (data = {}) => {
        const playerId = socket.data.playerId;
        const room = RoomsManager.fetchRoom(data.roomId);
        if (playerId !== (data.id ?? data.playerId) || !room?.players[playerId]?.isAlive
            || room.currentMeeting?.isActive || room.ended || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
        RoomsManager.players.updateState(data.roomId, playerId, { x: data.x, y: data.y, d: data.d });
        PlayersManager.updatePlayerState(playerId, { x: data.x, y: data.y, d: data.d, moving: data.moving });
        io.to(data.roomId).emit('player:moved', { ...data, id: playerId });
    };

    const playerKill = (data = {}, acknowledge) => {
        const room = RoomsManager.fetchRoom(data.roomId);
        const killerId = socket.data.playerId;
        const result = data.killerId === killerId
            ? attemptKill(room, killerId, data.playerId)
            : { ok: false, error: 'Nhân vật thực hiện không hợp lệ.' };
        if (result.ok) io.to(room.id).emit('player:killed', result.payload);
        reply(room, result, acknowledge);
        if (result.ok) checkWin(room.id);
    };

    const meetingEnd = (data = {}) => {
        const room = RoomsManager.fetchRoom(data.roomId);
        if (!room?.currentMeeting?.isActive) return;
        const results = RoomsManager.meetings.end(data.roomId);
        afterMeeting(room);
        // Match the client spawn reset so range checks use the same positions.
        for (const player of Object.values(room.players)) {
            if (player.isAlive) PlayersManager.updatePlayerState(player.id, { x: 560, y: 150, moving: false });
        }
        io.to(room.id).emit('meeting:ended', { roomId: room.id, results });
        broadcastState(room);
        checkWin(room.id);
    };

    const startAcceptedMeeting = (room, callerId, kind, bodyId) => {
        RoomsManager.meetings.create(room.id, callerId, meetingEnd);
        room.actions.bodies = {};
        io.to(room.id).emit('meeting:started', { roomId: room.id, callerId, kind, bodyId });
        broadcastState(room);
    };

    const meetingStart = (data = {}, acknowledge) => {
        const room = RoomsManager.fetchRoom(data.roomId);
        const callerId = socket.data.playerId;
        const result = data.callerId === callerId
            ? attemptEmergency(room, callerId)
            : { ok: false, error: 'Nhân vật thực hiện không hợp lệ.' };
        if (result.ok) startAcceptedMeeting(room, callerId, 'emergency');
        reply(room, result, acknowledge);
    };

    const bodyReport = (data = {}, acknowledge) => {
        const room = RoomsManager.fetchRoom(data.roomId);
        const callerId = socket.data.playerId;
        const result = attemptBodyReport(room, callerId, data.bodyId);
        if (result.ok) startAcceptedMeeting(room, callerId, 'body', data.bodyId);
        reply(room, result, acknowledge);
    };

    const meetingVote = (data = {}) => {
        const room = RoomsManager.fetchRoom(data.roomId);
        if (data.callerId !== socket.data.playerId || !room?.currentMeeting?.isActive || !room.players[data.callerId]?.isAlive) return;
        const allVoted = RoomsManager.meetings.vote(data.roomId, data.callerId, data.votedForId);
        io.to(data.roomId).emit('meeting:voted', data);
        if (allVoted) meetingEnd({ roomId: data.roomId });
    };

    socket.on('game:actions:get', (data = {}, acknowledge) => {
        const room = RoomsManager.fetchRoom(data.roomId);
        if (!room?.actions || !room.players[socket.data.playerId]) return;
        reply(room, { ok: true }, acknowledge);
    });
    socket.on('player:move', playerMove);
    socket.on('player:animation', data => socket.to(data.roomId).emit('player:animation', data));
    socket.on('player:kill', playerKill);
    socket.on('body:report', bodyReport);
    socket.on('meeting:start', meetingStart);
    socket.on('meeting:end', data => {
        const room = RoomsManager.fetchRoom(data?.roomId);
        if (room?.players[socket.data.playerId]?.isAlive) meetingEnd(data);
    });
    socket.on('meeting:vote', meetingVote);
};
