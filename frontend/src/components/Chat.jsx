import { useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus.js";
import styles from "./Chat.module.css";
import { getCharacterAvatar } from "../utils/characterAvatar.js";

const MAX_LENGTH = 200; // phải khớp với CHAT_MAX_LENGTH ở backend
const MAX_HISTORY = 100;

/**
 * Khung chat cho người chơi trong phòng.
 * Một nút bật chat; bấm vào thì khung chat lớn hiện giữa màn hình (che màn vote).
 * Người chơi phải đóng khung chat để tiếp tục vote.
 *
 * Luật:
 * - Phòng chờ: mọi người chat tự do.
 * - Trong ván: người sống chỉ chat khi đang họp; người chết chat riêng với người chết.
 *
 * @param {{socket: any, roomId: string|null, playerId: string|null, started: boolean, meetingActive: boolean}} props
 */
export default function Chat({ socket, roomId, playerId, started, meetingActive }) {
    const [messages, setMessages] = useState([]);
    const [text, setText] = useState("");
    const [open, setOpen] = useState(false);
    const [unread, setUnread] = useState(0);
    const [isDead, setIsDead] = useState(false);
    const [error, setError] = useState("");
    const listRef = useRef(null);
    const openRef = useRef(open);
    openRef.current = open;

    const canChat = !started || isDead || meetingActive;

    // Socket listeners
    useEffect(() => {
        setMessages([]);
        setIsDead(false);
        if (!socket || !roomId) return;

        const onMessage = (msg) => {
            if (msg.roomId !== roomId) return;
            setMessages((prev) => [...prev, msg].slice(-MAX_HISTORY));
            if (!openRef.current && msg.playerId !== playerId) setUnread((n) => n + 1);
        };
        const onKilled = (data) => {
            if (data.roomId === roomId && data.playerId === playerId) setIsDead(true);
        };
        const onMeetingEnded = (data) => {
            if (data.roomId === roomId && data.results?.ejectedId === playerId) setIsDead(true);
        };
        const onStarted = (data) => {
            if (data.roomId !== roomId) return;
            setIsDead(false);
            setMessages([]);
            setUnread(0);
        };

        socket.on("room:message", onMessage);
        socket.on("player:killed", onKilled);
        socket.on("meeting:ended", onMeetingEnded);
        socket.on("game:started", onStarted);
        return () => {
            socket.off("room:message", onMessage);
            socket.off("player:killed", onKilled);
            socket.off("meeting:ended", onMeetingEnded);
            socket.off("game:started", onStarted);
        };
    }, [socket, roomId, playerId]);

    // Không được chat nữa (vd. cuộc họp kết thúc) -> đóng khung chat
    useEffect(() => {
        if (!canChat) setOpen(false);
    }, [canChat]);

    // Mở khung: xoá badge và lỗi cũ
    useEffect(() => {
        if (!open) return;
        setUnread(0);
        setError("");
    }, [open]);

    // Tự cuộn xuống tin nhắn mới
    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, open]);

    // Enter ở bất kỳ đâu để mở chat, Esc để đóng
    useEffect(() => {
        if (!canChat) return;
        const onKey = (e) => {
            if (e.key === "Escape" && openRef.current) {
                setOpen(false);
                return;
            }
            if (e.key !== "Enter" || openRef.current) return;
            const tag = document.activeElement?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
            e.preventDefault();
            setOpen(true);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [canChat]);

    const send = (e) => {
        e.preventDefault();
        const message = text.trim();
        if (!message || !socket || !roomId) return;
        socket.emit("room:send:message", { roomId, message }, (res) => {
            setError(res?.ok ? "" : res?.message || "Không gửi được tin nhắn.");
        });
        setText("");
    };

    // Không cho Phaser nhận phím khi đang gõ (tránh di chuyển bằng WASD / chặn ký tự)
    const stopKeys = (e) => {
        e.stopPropagation();
        if (e.key === "Escape") setOpen(false);
    };

    if (!roomId || !canChat) return null;

    const ghostMode = isDead && started;

    return (
        <>
            <button
                className={`${styles.toggle} ${open ? styles.toggleActive : ""}`}
                onClick={() => setOpen((v) => !v)}
                aria-label={open ? "Đóng chat" : "Mở chat"}
                title="Chat (Enter)"
            >
                <ChatIcon />
                {unread > 0 && !open && (
                    <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span>
                )}
            </button>

            {open && (
                <div className={styles.backdrop} onMouseDown={() => setOpen(false)}>
                    <div
                        className={`${styles.window} ${ghostMode ? styles.ghost : ""}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-label="Chat"
                    >
                        <div className={styles.header}>
                            <span className={styles.title}>
                                {ghostMode ? "Kênh người đã chết" : meetingActive ? "Thảo luận" : "Chat phòng chờ"}
                            </span>
                            <button className={styles.close} onClick={() => setOpen(false)} aria-label="Đóng chat">
                                ✕
                            </button>
                        </div>

                        <div className={styles.list} ref={listRef}>
                            {messages.length === 0 && <div className={styles.empty}>Chưa có tin nhắn nào</div>}
                            {messages.map((m) => {
                                const mine = m.playerId === playerId;
                                return (
                                    <div
                                        key={m.id}
                                        className={`${styles.card} ${mine ? styles.mine : ""} ${m.dead ? styles.dead : ""}`}
                                    >
                                        <Avatar color={m.color} name={m.name} dead={m.dead} />
                                        <div className={styles.body}>
                                            <div className={styles.name}>{m.name}</div>
                                            <div className={styles.text}>{m.message}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <form className={styles.form} onSubmit={send}>
                            <div className={styles.meta}>
                                <span className={styles.error}>{error}</span>
                                <span className={styles.counter}>
                                    {text.length}/{MAX_LENGTH}
                                </span>
                            </div>
                            <div className={styles.inputRow}>
                                <input
                                    autoFocus
                                    className={styles.input}
                                    value={text}
                                    maxLength={MAX_LENGTH}
                                    placeholder={ghostMode ? "Chỉ người đã chết thấy tin này…" : "Nhập tin nhắn…"}
                                    onChange={(e) => setText(e.target.value)}
                                    onKeyDown={stopKeys}
                                    onKeyUp={stopKeys}
                                    onFocus={() => EventBus.emit("chat:focus")}
                                />
                                <button
                                    className={styles.send}
                                    type="submit"
                                    disabled={!text.trim()}
                                    aria-label="Gửi"
                                >
                                    <SendIcon />
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}

/** Avatar là nhân vật trong game, đổi sang màu của người chơi. */
function Avatar({ color, name, dead }) {
    const [src, setSrc] = useState(null);

    useEffect(() => {
        let alive = true;
        getCharacterAvatar(color)
            .then((url) => alive && setSrc(url))
            .catch(() => alive && setSrc(null));
        return () => {
            alive = false;
        };
    }, [color]);

    return (
        <div className={`${styles.avatar} ${dead ? styles.avatarDead : ""}`}>
            {src ? (
                <img src={src} alt={name} draggable={false} />
            ) : (
                <span className={styles.avatarFallback} style={{ background: color || "#888" }} />
            )}
            {dead && <span className={styles.ghostMark}>👻</span>}
        </div>
    );
}

function ChatIcon() {
    return (
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
            <path
                d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
                fill="currentColor"
            />
            <circle cx="8.5" cy="11" r="1.3" fill="#1b2433" />
            <circle cx="12" cy="11" r="1.3" fill="#1b2433" />
            <circle cx="15.5" cy="11" r="1.3" fill="#1b2433" />
        </svg>
    );
}

function SendIcon() {
    return (
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M3 20.5 21 12 3 3.5l2.5 7L15 12l-9.5 1.5z" fill="currentColor" />
        </svg>
    );
}
