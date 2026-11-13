import { PlayersManager } from "../managers/players.manager.js";
import { RoomsManager } from "../managers/rooms.manager.js";
import { TasksManager } from "../managers/tasks.manager.js";

/**
 * @typedef {{id: string, name: string, color: string}} RegisterData
 * @typedef {{playerId: string}} PlayerIdData
 * @typedef {{hostId: string, roomId: string, questions?: unknown}} RoomCreateData
 * @typedef {{playerId: string, roomId: string}} RoomJoinData
 * @typedef {{roomId: string}} GameStartData
 * @typedef {{roomId: string, message: string}} SendMessageData
 */

// Track socket to player mapping for cleanup on disconnect
/** @type {{[socketId: string]: string}} */
const socketToPlayerId = {};

const CHAT_MAX_LENGTH = 200; // phải khớp với MAX_LENGTH ở frontend/src/components/Chat.jsx
const CHAT_COOLDOWN_MS = 500;

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @returns {void}
 */
export const registerRoomEvents = (io, socket) => {
    /**
     * @param {RegisterData} data
     * @returns {void}
     */
    const playerRegister = (data) => {
        console.log("Player register received:", data);
        PlayersManager.createPlayer(data.id, data.name, data.color);
        socket.data.playerId = data.id;
        socket.emit("player:registered", { playerId: data.id });
    };

    /**
     * @param {PlayerIdData} data
     * @returns {void}
     */
    const playerUnregister = (data) => {
        console.log("Player unregister received:", data);
        PlayersManager.deletePlayer(data.playerId);
        // TODO REMOVE FROM THE ROOM TOO AND SEND WIN CONDITION CHECK
        socket.emit("player:unregistered");
    };

    /**
     * @param {RoomCreateData} data
     * @returns {void}
     */
    const roomCreate = (data) => {
        console.log("Room create received:", data);
        const player = PlayersManager.getPlayer(data.hostId);
        if (!player) {
            console.error("Player not found for room creation:", data.hostId);
            return;
        }

        const questions = RoomsManager.parseQuestions(
            data.roomId,
            data.questions,
        );
        if (!questions) {
            socket.emit("room:join:error", {
                message:
                    "Danh sách câu hỏi không hợp lệ. Cần ít nhất 2 câu, mỗi câu có title, explain, options (ít nhất 2 lựa chọn, không trùng nhau) và answer nằm trong options.",
            });
            return;
        }

        const room = RoomsManager.createRoom(data.roomId, player, questions);
        if (!room) {
            socket.emit("room:join:error", { message: "Mã phòng đã tồn tại." });
            return;
        }

        io.emit("room:created", {
            roomId: data.roomId,
            room: RoomsManager.toPublicRoom(room),
        });
        roomJoin({ playerId: data.hostId, roomId: data.roomId });
    };

    /**
     * @param {RoomJoinData} data
     * @returns {void}
     */
    const roomJoin = (data) => {
        console.log("Room join received:", data);
        if (!data?.playerId || !data?.roomId) {
            socket.emit("room:join:error", {
                message: "Missing playerId or roomId",
            });
            return;
        }

        // Track socket to player mapping for cleanup on unexpected disconnect
        socketToPlayerId[socket.id] = data.playerId;

        const player = PlayersManager.getPlayer(data.playerId);
        if (!player) {
            socket.emit("room:join:error", {
                message: "Player not registered. Register first.",
            });
            console.error("Player not found for room join:", data.playerId);
            return;
        }

        if (player.roomId && player.roomId !== data.roomId) {
            roomLeave({ playerId: data.playerId });
        }

        const room = RoomsManager.fetchRoom(data.roomId);
        if (!room || room.started) {
            socket.emit("room:join:error", {
                message: "Room not found or game already started",
            });
            console.error(
                "Room not found or game already started:",
                data.roomId,
            );
            return;
        }

        const joinedPlayer = RoomsManager.players.add(data.roomId, player);
        if (!joinedPlayer) {
            socket.emit("room:join:error", { message: "Could not join room" });
            return;
        }

        socket.join(data.roomId);
        // TODO remove sending whole room object with imposter
        const publicRoom = RoomsManager.toPublicRoom(room);
        socket.emit("room:joined", {
            roomId: data.roomId,
            room: publicRoom,
            player: joinedPlayer,
            started: room.started,
        });
        socket.to(data.roomId).emit("player:joined", {
            player: joinedPlayer,
            roomId: data.roomId,
        });
    };

    /**
     * @param {PlayerIdData} data
     * @returns {void}
     */
    const roomLeave = (data) => {
        console.log("Room leave received:", data);
        const player = PlayersManager.getPlayer(data.playerId);
        if (!player) return;

        const roomId = player.roomId;
        if (!roomId) {
            PlayersManager.resetPlayer(data.playerId);
            return;
        }

        const { deleted } = RoomsManager.players.remove(roomId, player);
        const remainingRoom = RoomsManager.fetchRoom(roomId);
        if (remainingRoom?.started) {
            io.to(roomId).emit("game:task-progress", {
                roomId,
                ...TasksManager.progress(remainingRoom),
            });
        }
        PlayersManager.resetPlayer(data.playerId);

        const win = RoomsManager.checkWin(roomId);
        console.log("Win condition check after player leave:", win);
        if (win !== null && remainingRoom) {
            remainingRoom.started = false;
            io.to(roomId).emit("game:ended", { roomId, isImposter: win });
        }

        io.to(roomId).emit("player:left", { playerId: player.id });
        PlayersManager.setRoomId(player.id, null);
        socket.leave(roomId);
        socket.leave(`${roomId}:spectators`);
        if (deleted) {
            io.emit("room:deleted", { roomId });
        }
    };

    /**
     * @param {GameStartData} data
     * @returns {Promise<void>}
     */
    const gameStart = async (data) => {
        console.log("Game start received:", data);
        const room = RoomsManager.fetchRoom(data.roomId);
        if (!room) {
            socket.emit("game:notif", { message: "Room not found" });
            return;
        }
        if (
            room.started ||
            socket.data.playerId !== room.host.id ||
            !socket.rooms.has(room.id)
        ) {
            return;
        }
        if (room.questions.length < 2) {
            socket.emit("game:notif", {
                message: "Cần ít nhất 2 câu hỏi trước khi bắt đầu ván chơi.",
            });
            return;
        }
        if (Object.values(room.players).length <= 1) {
            socket.emit("game:notif", {
                message: "Need at least 2 players to start the game",
            });
            return;
        }

        // Xóa spectator của ván trước, ván mới ai cũng sống
        io.socketsLeave(`${data.roomId}:spectators`);
        RoomsManager.startGame(data.roomId);
        io.to(data.roomId).emit("game:started", data);
        io.to(data.roomId).emit("game:task-progress", {
            roomId: room.id,
            ...TasksManager.progress(room),
        });

        // Mỗi người chơi chỉ nhận vai trò và nhiệm vụ của riêng mình
        const sockets = await io.in(data.roomId).fetchSockets();
        for (const s of sockets) {
            const playerId = s.data.playerId;
            if (typeof playerId !== "string") continue;
            io.to(s.id).emit("game:role", {
                isImposter: room.imposter === playerId,
            });
            io.to(s.id).emit(
                "game:tasks",
                TasksManager.snapshot(room, playerId),
            );
        }
    };

    /**
     * @param {SendMessageData} data
     * @param {(response: {ok: boolean, message?: string}) => void} [ack]
     * @returns {void}
     */
    const sendMessage = (data, ack) => {
        const reply = typeof ack === "function" ? ack : () => {};
        const reject = (message = "") => reply({ ok: false, message });

        const roomId = typeof data?.roomId === "string" ? data.roomId : "";
        const playerId = socket.data.playerId;
        const room = RoomsManager.fetchRoom(roomId);
        const player = room?.players[playerId];
        if (!room || !player || !socket.rooms.has(roomId))
            return reject("Bạn không ở trong phòng này.");

        const text =
            typeof data.message === "string"
                ? data.message.replace(/\s+/g, " ").trim()
                : "";
        if (!text) return reject("Tin nhắn trống.");
        if (text.length > CHAT_MAX_LENGTH)
            return reject(`Tin nhắn tối đa ${CHAT_MAX_LENGTH} ký tự.`);

        const now = Date.now();
        if (now - (socket.data.lastChatAt ?? 0) < CHAT_COOLDOWN_MS)
            return reject("Bạn gửi quá nhanh.");

        const isDead = room.started && player.isAlive === false;
        const inMeeting = !!room.currentMeeting?.isActive;
        // Trong ván: người sống chỉ chat khi đang họp; người chết chỉ chat với người chết
        if (room.started && !isDead && !inMeeting)
            return reject("Chỉ có thể chat trong cuộc họp.");

        socket.data.lastChatAt = now;
        const payload = {
            id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
            roomId,
            playerId,
            name: player.name,
            color: player.color,
            message: text,
            dead: isDead,
            ts: now,
        };
        io.to(isDead ? `${roomId}:spectators` : roomId).emit(
            "room:message",
            payload,
        );
        reply({ ok: true });
    };

    /**
     * @param {string} reason
     * @returns {void}
     */
    const disconnect = (reason) => {
        console.log("Socket disconnected. Reason:", reason);
        // Handle unexpected disconnections by cleaning up the player
        const playerId = socketToPlayerId[socket.id];
        if (playerId) {
            console.log("Cleaning up disconnected player:", playerId);
            const player = PlayersManager.getPlayer(playerId);
            if (player && player.roomId) {
                const roomId = player.roomId;
                const { deleted } = RoomsManager.players.remove(roomId, player);
                const remainingRoom = RoomsManager.fetchRoom(roomId);
                if (remainingRoom?.started) {
                    io.to(roomId).emit("game:task-progress", {
                        roomId,
                        ...TasksManager.progress(remainingRoom),
                    });
                }
                socket.to(roomId).emit("player:left", { playerId: player.id });
                PlayersManager.deletePlayer(playerId);

                // Check win condition after player removal
                const win = RoomsManager.checkWin(roomId);
                if (win !== null && remainingRoom) {
                    remainingRoom.started = false;
                    io.to(roomId).emit("game:ended", {
                        roomId,
                        isImposter: win,
                    });
                }

                if (deleted) {
                    io.emit("room:deleted", { roomId });
                }
            }
            delete socketToPlayerId[socket.id];
        }
    };

    /**
     * @param {PlayerIdData} data
     * @returns {void}
     */
    const playerDisconnect = (data) => {
        console.log("Player disconnected:", data);
        const player = PlayersManager.getPlayer(data.playerId);
        if (player) {
            const roomId = player.roomId;
            if (roomId) {
                const { deleted } = RoomsManager.players.remove(roomId, player);
                const remainingRoom = RoomsManager.fetchRoom(roomId);
                if (remainingRoom?.started) {
                    io.to(roomId).emit("game:task-progress", {
                        roomId,
                        ...TasksManager.progress(remainingRoom),
                    });
                }
                socket.to(roomId).emit("player:left", { playerId: player.id });
                PlayersManager.deletePlayer(data.playerId);

                // Check win condition after player removal
                const win = RoomsManager.checkWin(roomId);
                if (win !== null && remainingRoom) {
                    remainingRoom.started = false;
                    io.to(roomId).emit("game:ended", {
                        roomId,
                        isImposter: win,
                    });
                }

                if (deleted) {
                    io.emit("room:deleted", { roomId });
                }
            } else {
                PlayersManager.deletePlayer(data.playerId);
            }
        }
        // Clean up socket mapping
        delete socketToPlayerId[socket.id];
    };

    socket.on("log", (/** @type {unknown} */ data) => {
        console.log(data);
    });
    socket.on("player:register", playerRegister);
    socket.on("player:unregister", playerUnregister);
    socket.on("player:disconnect", playerDisconnect);
    socket.on("room:create", roomCreate);
    socket.on("room:join", roomJoin);
    socket.on("room:leave", roomLeave);
    socket.on("game:start", gameStart);
    socket.on("room:send:message", sendMessage);
    socket.on("disconnect", disconnect);
    // TODO cleanup old imposter sending logic
};
