import { RoomsManager } from "../managers/rooms.manager.js";
import { PlayersManager } from "../managers/players.manager.js";

/**
 * @typedef {import('../types/room.type.js').MeetingResults} MeetingResults
 */

/**
 * @typedef {{
 *   roomId: string,
 *   id?: string,
 *   playerId?: string,
 *   x: number,
 *   y: number,
 *   d: string,
 *   moving: boolean
 * }} PlayerMoveData
 */

/**
 * @typedef {{roomId: string, [key: string]: unknown}} PlayerAnimData
 */

/**
 * @typedef {{roomId: string, playerId: string, killerId: string}} PlayerKillData
 */

/**
 * @typedef {{roomId: string, callerId: string, bodyId?: string, reason?: string}} MeetingStartData
 */

/**
 * @typedef {{roomId: string, results?: MeetingResults|null}} MeetingEndData
 */

/**
 * @typedef {{roomId: string, callerId: string, votedForId: string|null}} MeetingVoteData
 */

/** Room phụ chỉ chứa người đã chết (spectator). Phải khớp với roomEvents.js */
const spectatorRoomOf = (roomId = "") => `${roomId}:spectators`;
export const REPORT_RADIUS = 60;

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @returns {void}
 */
export const registerGameEvents = (io, socket) => {
    // see comment below about playerJoin
    // /**
    //  * @param {{player: import('../types/room.type.js').Player, roomId: string}} data
    //  */
    // const playerJoin = (data) => {
    //     console.log("Player join received:", data);
    //     socket.to(data.roomId).emit("player:joined", data);
    // }

    const KILL_COOLDOWN_MS = 25000; // 20 giây, phải khớp với frontend

    /** key: `${roomId}:${killerId}` -> thời điểm kill hợp lệ gần nhất */
    const lastKillAt = new Map();

    // ====== PLAYER EVENTS ======

    /**
     * @param {PlayerMoveData} data
     * @returns {void}
     */
    const playerMove = (data) => {
        // Frontend emits `id`; accept either id or playerId
        const playerId = data.id ?? data.playerId;
        if (!data.roomId || !playerId) return;
        if (socket.data.playerId !== playerId || !socket.rooms.has(data.roomId))
            return;
        if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;

        RoomsManager.players.updateState(data.roomId, playerId, {
            x: data.x,
            y: data.y,
            d: data.d,
        });
        PlayersManager.updatePlayerState(playerId, {
            x: data.x,
            y: data.y,
            d: data.d,
            moving: data.moving,
        });

        const victim = RoomsManager.fetchRoom(data.roomId)?.players[playerId];
        if (victim && victim.isAlive === false) {
            // Người đã chết: chỉ gửi cho spectator, người còn sống không thấy
            io.to(spectatorRoomOf(data.roomId)).emit("player:moved", data);
            return;
        }

        io.to(data.roomId).emit("player:moved", data);
    };

    /**
     * @param {PlayerAnimData} data
     * @returns {void}
     */
    const playerAnim = (data) => {
        io.to(data.roomId).emit("player:animation", data);
    };

    /**
     * Client đã chết gọi sau khi nhận player:killed để vào room spectator.
     * @param {{roomId: string, playerId: string}} data
     * @returns {void}
     */
    const playerSpectate = (data) => {
        const room = RoomsManager.fetchRoom(data.roomId);
        const player = room?.players[data.playerId];
        if (!player || player.isAlive !== false) return;
        socket.join(spectatorRoomOf(data.roomId));
    };

    /**
     * @param {PlayerKillData} data
     * @returns {void}
     */
    const playerKill = (data) => {
        console.log("Player kill received:", data);
        const { roomId, playerId, killerId } = data;

        const reject = (reason = "", remainingMs = 0) => {
            console.log(`Player kill rejected (${reason}):`, data);
            socket.emit("player:kill:rejected", {
                reason,
                remainingMs,
                playerId,
            });
        };

        const room = RoomsManager.fetchRoom(roomId);
        if (!room) return reject("ROOM_NOT_FOUND");
        if (!room.started || room.currentMeeting?.isActive)
            return reject("GAME_UNAVAILABLE");

        const killer = room.players[killerId];
        const victim = room.players[playerId];

        if (!killer || killer.isAlive === false) return reject("KILLER_DEAD");
        if (!victim || victim.isAlive === false) return reject("VICTIM_DEAD");
        if (playerId === killerId) return reject("SELF_KILL");

        const key = `${roomId}:${killerId}`;
        const now = Date.now();
        const remainingMs =
            KILL_COOLDOWN_MS - (now - (lastKillAt.get(key) ?? 0));
        if (remainingMs > 0) return reject("COOLDOWN", remainingMs);

        lastKillAt.set(key, now);
        victim.isAlive = false;

        // Report checks use the corpse position, never the ghost's later position.
        const body = {
            playerId,
            x: victim.state.x,
            y: victim.state.y,
            color: victim.color,
        };
        room.deadBodies ??= {};
        room.deadBodies[playerId] = body;
        io.to(roomId).emit("player:killed", { roomId, killerId, ...body });

        const win = RoomsManager.checkWin(roomId);
        if (win !== null) {
            room.started = false;
            io.to(roomId).emit("game:ended", { roomId, isImposter: win });
        }
    };

    // ===== MEETING EVENTS ======

    /**
     * @param {MeetingStartData} data
     * @returns {boolean}
     */
    const meetingStart = (data) => {
        const room = RoomsManager.fetchRoom(data.roomId);
        if (!room?.started || room.currentMeeting?.isActive) return false;
        RoomsManager.meetings.create(data.roomId, data.callerId, meetingEnd);
        io.to(data.roomId).emit("meeting:started", {
            ...data,
            players: room.players,
        });
        return true;
    };

    /**
     * Xử lý yêu cầu báo cáo xác chết.
     *
     * @param {MeetingStartData} data - Thông tin cuộc họp được tạo từ việc báo xác.
     * @param {(response: { ok: boolean, message?: string }) => void} [ack] - Callback phản hồi kết quả cho client.
     * @returns {void}
     */
    const bodyReport = (data, ack) => {
        /** @type {(response: {ok: boolean, message?: string}) => void} */
        const reply = typeof ack === "function" ? ack : () => {};
        const reject = (message = "") => reply({ ok: false, message });

        if (
            !data ||
            typeof data.roomId !== "string" ||
            typeof data.bodyId !== "string"
        )
            return reject("Thông tin báo xác không hợp lệ.");

        const room = RoomsManager.fetchRoom(data.roomId);
        const callerId = socket.data.playerId;
        const player = room?.players[callerId];

        if (!room?.started || !socket.rooms.has(data.roomId) || !player)
            return reject("Bạn không ở trong ván chơi này.");

        if (!player.isAlive) return reject("Người đã chết không thể báo xác.");

        if (room.currentMeeting?.isActive)
            return reject("Cuộc họp đang diễn ra.");

        const body =
            room?.deadBodies && data.bodyId in room.deadBodies
                ? room.deadBodies[data.bodyId]
                : null;
        if (!body) return reject("Xác này không còn trên bản đồ.");

        if (
            !Number.isFinite(player.state.x) ||
            !Number.isFinite(player.state.y) ||
            Math.hypot(player.state.x - body.x, player.state.y - body.y) >
                REPORT_RADIUS
        ) {
            return reject("Bạn cần đến gần xác để báo cáo.");
        }

        meetingStart({
            roomId: room.id,
            callerId,
            bodyId: body.playerId,
            reason: "report",
        });

        reply({ ok: true });
    };

    /**
     * Xử lý kết thúc cuộc họp.
     *
     * @param {MeetingEndData} data - Dữ liệu kết thúc cuộc họp.
     * @returns {void}
     */
    const meetingEnd = (data) => {
        console.log("Received meeting end", data);

        data.results = RoomsManager.meetings.end(data.roomId);
        if (!data.results) return;

        const room = RoomsManager.fetchRoom(data.roomId);
        if (!room) return;

        room.deadBodies = {};

        // Người bị loại cũng vào room spectator để thấy chat của người đã chết
        const ejectedId = data.results.ejectedId;
        if (ejectedId) {
            for (const s of io.sockets.sockets.values()) {
                if (s.data.playerId === ejectedId && s.rooms.has(data.roomId))
                    s.join(spectatorRoomOf(data.roomId));
            }
        }

        io.to(data.roomId).emit("meeting:ended", data);

        // Check win condition after meeting
        const roomId = data.roomId;
        const win = RoomsManager.checkWin(roomId);

        console.log("Win condition check after meeting:", win);

        if (win !== null) {
            const currentRoom = RoomsManager.fetchRoom(roomId);

            if (!currentRoom) return;

            currentRoom.started = false;

            io.to(roomId).emit("game:ended", {
                roomId,
                isImposter: win,
            });
        }
    };

    /**
     * @param {MeetingVoteData} data
     * @returns {void}
     */
    const meetingVote = (data) => {
        console.log("Recieved meeting vote", data);
        const room = RoomsManager.fetchRoom(data.roomId);

        if (!room?.currentMeeting?.isActive) {
            socket.emit("meeting:vote:rejected", {
                reason: "NO_ACTIVE_MEETING",
            });
            return;
        }

        // Người đã chết không được bỏ phiếu
        const voter = room.players[data.callerId];
        if (!voter || voter.isAlive === false) {
            socket.emit("meeting:vote:rejected", { reason: "VOTER_DEAD" });
            return;
        }

        // Không được vote cho người đã chết (null = bỏ qua)
        if (data.votedForId != null) {
            const target = room.players[data.votedForId];
            if (!target || target.isAlive === false) {
                socket.emit("meeting:vote:rejected", { reason: "TARGET_DEAD" });
                return;
            }
        }

        const allVoted = RoomsManager.meetings.vote(
            data.roomId,
            data.callerId,
            data.votedForId,
        );
        io.to(data.roomId).emit("meeting:voted", data);

        if (allVoted) {
            console.log("All players voted, ending meeting early");
            meetingEnd({ roomId: data.roomId });
        }
    };

    // socket.on("player:join", playerJoin); looks useless for now as room:join already does the job
    socket.on("player:move", playerMove);
    socket.on("player:animation", playerAnim);
    socket.on("player:kill", playerKill);
    socket.on("player:spectate", playerSpectate);
    socket.on("meeting:start", meetingStart);
    socket.on("body:report", bodyReport);
    socket.on("meeting:end", meetingEnd);
    socket.on("meeting:vote", meetingVote);
};
