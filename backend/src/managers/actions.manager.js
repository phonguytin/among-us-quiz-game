import {
  KILL_COOLDOWN_MS, EMERGENCY_COOLDOWN_MS, KILL_RANGE, REPORT_RANGE,
  EMERGENCY_POSITION, EMERGENCY_RANGE,
} from '../../../shared/gameRules.mjs';

export function initializeActions(room, now = Date.now()) {
  room.ended = false;
  room.actions = {
    killReadyAt: now + KILL_COOLDOWN_MS,
    emergencyReadyAt: now + EMERGENCY_COOLDOWN_MS,
    emergencyUsed: {}, bodies: {},
  };
}

export function actionState(room, playerId, now = Date.now()) {
  return {
    roomId: room.id, serverNow: now,
    killReadyAt: room.actions.killReadyAt,
    emergencyReadyAt: room.actions.emergencyReadyAt,
    emergencyUsed: Boolean(room.actions.emergencyUsed[playerId]),
  };
}

function actorError(room, playerId) {
  if (!room?.started || room.ended || !room.actions) return 'Trận đấu chưa sẵn sàng.';
  if (!room.players[playerId]?.isAlive) return 'Chỉ người chơi còn sống mới được thực hiện.';
  if (room.currentMeeting?.isActive) return 'Đang có cuộc họp.';
  return null;
}

function distance(a, b) {
  if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function attemptKill(room, killerId, targetId, now = Date.now()) {
  const error = actorError(room, killerId);
  if (error) return { ok: false, error };
  if (room.imposter !== killerId) return { ok: false, error: 'Chỉ imposter mới được kill.' };
  const target = room.players[targetId];
  if (targetId === killerId || !target?.isAlive) return { ok: false, error: 'Mục tiêu phải là người chơi còn sống.' };
  if (now < room.actions.killReadyAt) return { ok: false, error: 'Kill đang hồi chiêu.' };
  if (distance(room.players[killerId].state, target.state) > KILL_RANGE) return { ok: false, error: 'Mục tiêu ở quá xa.' };

  room.actions.killReadyAt = now + KILL_COOLDOWN_MS;
  target.isAlive = false;
  const { x, y } = target.state;
  room.players[killerId].state = { ...room.players[killerId].state, x, y, moving: false };
  room.actions.bodies[targetId] = { id: targetId, x, y };
  return { ok: true, payload: { roomId: room.id, playerId: targetId, killerId, x, y, color: target.color } };
}

export function attemptEmergency(room, callerId, now = Date.now()) {
  const error = actorError(room, callerId);
  if (error) return { ok: false, error };
  if (room.actions.emergencyUsed[callerId]) return { ok: false, error: 'Bạn đã dùng lượt gọi họp trong trận này.' };
  if (now < room.actions.emergencyReadyAt) return { ok: false, error: 'Nút gọi họp đang hồi chiêu.' };
  if (distance(room.players[callerId].state, EMERGENCY_POSITION) > EMERGENCY_RANGE) return { ok: false, error: 'Bạn cần đến gần nút gọi họp.' };
  room.actions.emergencyUsed[callerId] = true;
  return { ok: true };
}

export function attemptBodyReport(room, callerId, bodyId) {
  const error = actorError(room, callerId);
  if (error) return { ok: false, error };
  const body = room.actions.bodies[bodyId];
  if (!body) return { ok: false, error: 'Xác này đã được báo cáo hoặc không tồn tại.' };
  if (distance(room.players[callerId].state, body) > REPORT_RANGE) return { ok: false, error: 'Bạn cần đến gần xác.' };
  // No per-player limit and no emergency-button cooldown for body reports.
  return { ok: true };
}

export function afterMeeting(room, now = Date.now()) {
  room.actions.killReadyAt = now + KILL_COOLDOWN_MS;
  room.actions.emergencyReadyAt = now + EMERGENCY_COOLDOWN_MS;
}
