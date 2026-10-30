import { KILL_RANGE } from '../../../../shared/gameRules.mjs';
import { nearestLivingPlayer } from './killTarget.js';
import { requestAction, secondsRemaining } from './actionState.js';

export function handleImposter(scene) {
    if (!scene.imposter || !scene.player) return;
    scene.killBtn = scene.add.image(820, 410, 'kill')
        .setScale(0.7).setDepth(1000).setScrollFactor(0).setInteractive()
        .on('pointerdown', () => {
            handleNearestPlayer(scene);
            const victim = scene.closest.player;
            if (!victim || !scene.actionState || secondsRemaining(scene.actionState.killReadyAt)
                || scene.actionPending || scene.taskActive || scene.meetingActive || !scene.player?.alive) return;
            // Teleport/kill only after the server accepts and broadcasts player:killed.
            requestAction(scene, 'player:kill', {
                roomId: scene.room.id, playerId: victim.id, killerId: scene.playerObj.id,
            });
        });
    scene.killLabel = scene.add.text(820, 470, '', {
        fontFamily: 'Arial', fontSize: '18px', color: '#ffffff', backgroundColor: '#000000', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0);
    scene.ui.add([scene.killBtn, scene.killLabel]);
}

export function handleImposterMovement(scene) {
    handleNearestPlayer(scene);
    if (!scene.killBtn) return;
    const seconds = scene.actionState ? secondsRemaining(scene.actionState.killReadyAt) : null;
    const available = seconds === 0 && scene.closest.player && !scene.actionPending
        && !scene.taskActive && !scene.meetingActive && scene.player?.active && scene.player.alive;
    if (available) scene.killBtn.resetPipeline();
    else scene.killBtn.setPipeline('GrayScale');
    scene.killBtn.setAlpha(available ? 1 : 0.55);
    scene.killLabel.setText(seconds === null ? 'Đang đồng bộ…' : seconds > 0 ? `${seconds}s` : 'Kill');
}

export function handleNearestPlayer(scene) {
    const player = scene.player;
    const nearest = scene.imposter && !scene.taskActive && !scene.meetingActive
        ? nearestLivingPlayer(player, scene.players, KILL_RANGE) : null;
    scene.closest = {
        player: nearest,
        distance: nearest ? Math.hypot(player.x - nearest.x, player.y - nearest.y) : KILL_RANGE,
    };
}
