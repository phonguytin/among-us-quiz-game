export function localActionState(state, now = Date.now()) {
  return {
    killReadyAt: now + Math.max(0, state.killReadyAt - state.serverNow),
    emergencyReadyAt: now + Math.max(0, state.emergencyReadyAt - state.serverNow),
    emergencyUsed: state.emergencyUsed,
  };
}

export function secondsRemaining(deadline, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function applyActionState(scene, state) {
  if (!state || state.roomId !== scene.room?.id) return;
  scene.actionState = localActionState(state);
}

export function requestAction(scene, event, payload, onSuccess) {
  if (scene.actionPending || !scene.socket?.connected) return;
  scene.actionPending = true;
  scene.socket.timeout(5000).emit(event, payload, (error, response) => {
    scene.actionPending = false;
    if (!scene.scene.isActive()) return;
    applyActionState(scene, response?.state);
    if (!error && response?.ok) onSuccess?.(response);
    else {
      const message = error ? 'Không nhận được phản hồi. Vui lòng thử lại.' : response?.error || 'Không thực hiện được thao tác.';
      if (window.showToast) window.showToast(message, 'warning', 3000);
      else console.warn(message);
    }
  });
}
