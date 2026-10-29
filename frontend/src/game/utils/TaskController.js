import { EventBus } from '../EventBus.js';
import { TASK_ZONES, REPORT_RADIUS } from '../config/taskZones.js';
import { nearestInRange } from './proximity.js';

// Scene owns proximity and movement; React owns the accessible question form.
export class TaskController {
  constructor(scene) {
    this.scene = scene;
    this.bodies = new Map();
    this.deaths = new Set();
    this.epoch = 0;
    this.markers = TASK_ZONES.map(zone => {
      const marker = scene.add.rectangle(zone.x, zone.y, zone.width, zone.height)
        .setStrokeStyle(2, 0xffdf3e).setDepth(2);
      scene.worldContainer.add(marker);
      return { zone, marker };
    });
    this.open = this.open.bind(this);
    this.close = this.close.bind(this);
    this.report = this.report.bind(this);
    this.sync = () => this.update(true);
    EventBus.on('task:open', this.open);
    EventBus.on('task:close', this.close);
    EventBus.on('body:report', this.report);
    EventBus.on('interaction:sync', this.sync);
    scene.taskActive = false;
    this.update(true);
  }

  canInteract() {
    const scene = this.scene;
    return scene.player?.active && scene.player.alive && !scene.meetingActive && !scene.taskActive;
  }

  update(force = false) {
    const scene = this.scene;
    const canInteract = this.canInteract();
    this.nearbyTask = canInteract ? nearestInRange(scene.player, TASK_ZONES) : null;
    this.nearbyBody = canInteract ? nearestInRange(scene.player, this.bodies.values(), REPORT_RADIUS) : null;
    for (const { marker, zone } of this.markers) {
      marker.visible = Boolean(scene.player?.active && !scene.meetingActive
        && Math.hypot(scene.player.x - zone.x, scene.player.y - zone.y) <= scene.VISION_RADIUS);
    }
    const key = `${this.nearbyTask?.id ?? ''}:${this.nearbyBody?.id ?? ''}`;
    if (force || key !== this.lastKey) {
      this.lastKey = key;
      EventBus.emit('interaction:nearby', {
        task: this.nearbyTask ? { id: this.nearbyTask.id, label: this.nearbyTask.label } : null,
        body: this.nearbyBody ? { id: this.nearbyBody.id } : null,
      });
    }
  }

  open() {
    this.update(); // Revalidate at click time, including death/meeting state.
    if (!this.nearbyTask) return;
    const scene = this.scene;
    const task = this.nearbyTask;
    scene.taskActive = true;
    scene.player.body?.setVelocity(0, 0);
    scene.player.anims?.stop();
    scene.input.keyboard.resetKeys();
    scene.input.keyboard.enabled = false;
    // Notify other clients that the player stopped, rather than leaving a walk animation running.
    scene.socket?.emit('player:move', {
      id: scene.playerObj.id, roomId: scene.room.id,
      x: scene.player.x, y: scene.player.y, d: scene.playerObj.state.d, moving: false,
    });
    scene.wasMoving = false;
    EventBus.emit('task:opened', { ...task, roomId: scene.room.id });
    this.update(true);
  }

  close() {
    const scene = this.scene;
    scene.taskActive = false;
    scene.input.keyboard.resetKeys();
    scene.input.keyboard.enabled = true;
    this.update(true);
  }

  addBody(id, sprite) {
    this.bodies.set(String(id), { id: String(id), x: sprite.x, y: sprite.y, sprite, reported: false });
    this.update(true);
  }

  report() {
    this.update();
    const body = this.nearbyBody;
    if (!body) return;
    body.reported = true;
    const payload = { result: true, roomId: this.scene.room.id, reporterId: this.scene.playerObj.id, bodyId: body.id };
    // Scope requested by phong.docx: console confirmation only, no meeting event.
    console.log('[Report] thành công', payload);
    EventBus.emit('body:reported', payload);
    this.update(true);
  }

  reset({ clearBodies = false } = {}) {
    this.close();
    if (clearBodies) {
      this.epoch += 1;
      for (const body of this.bodies.values()) body.sprite.destroy();
      this.bodies.clear();
    }
    EventBus.emit('interaction:reset');
    this.update(true);
  }

  destroy() {
    this.reset({ clearBodies: true });
    EventBus.off('task:open', this.open);
    EventBus.off('task:close', this.close);
    EventBus.off('body:report', this.report);
    EventBus.off('interaction:sync', this.sync);
    this.markers.forEach(({ marker }) => marker.destroy());
    EventBus.emit('interaction:reset');
  }
}
