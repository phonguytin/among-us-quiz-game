import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeActions, actionState, attemptKill, attemptEmergency, attemptBodyReport, afterMeeting } from '../src/managers/actions.manager.js';

function game() {
  const room = { id: 'room', started: true, imposter: 'killer', players: {}, currentMeeting: null };
  for (const id of ['killer', 'a', 'b', 'c']) room.players[id] = { id, isAlive: true, color: id, state: { x: 530, y: 100 } };
  initializeActions(room, 1000);
  return room;
}

test('kill cooldown applies on spawn and after every accepted kill; corpses cannot be killed', () => {
  const room = game();
  assert.equal(attemptKill(room, 'killer', 'a', 20999).ok, false);
  assert.equal(room.players.a.isAlive, true);
  const killed = attemptKill(room, 'killer', 'a', 21000);
  assert.equal(killed.ok, true);
  assert.equal(killed.payload.color, 'a');
  assert.equal(room.players.a.isAlive, false);
  assert.equal(room.actions.killReadyAt, 41000);
  assert.deepEqual(room.actions.bodies.a, { id: 'a', x: 530, y: 100 });
  assert.equal(attemptKill(room, 'killer', 'b', 21000).ok, false);
  assert.equal(attemptKill(room, 'killer', 'a', 41000).ok, false);
  assert.equal(attemptKill(room, 'killer', 'b', 41000).ok, true);
});

test('kill rejects self, unknown/dead/out-of-range players, crewmates, meetings, and ended games', () => {
  const room = game();
  for (const [actor, target] of [['killer','killer'], ['killer','missing'], ['a','b'], ['missing','a']]) {
    assert.equal(attemptKill(room, actor, target, 21000).ok, false);
  }
  room.players.a.state.x += 61;
  assert.equal(attemptKill(room, 'killer', 'a', 21000).ok, false);
  room.players.a.state.x -= 61;
  room.currentMeeting = { isActive: true };
  assert.equal(attemptKill(room, 'killer', 'a', 21000).ok, false);
  room.currentMeeting.isActive = false;
  room.ended = true;
  assert.equal(attemptKill(room, 'killer', 'a', 21000).ok, false);
  assert.equal(room.players.a.isAlive, true);
});

test('emergency button has initial cooldown and one use per player per game', () => {
  const room = game();
  assert.equal(attemptEmergency(room, 'a', 20999).ok, false);
  assert.equal(actionState(room, 'a').emergencyUsed, false);
  room.players.a.state.x = 900;
  assert.equal(attemptEmergency(room, 'a', 21000).ok, false);
  assert.equal(actionState(room, 'a').emergencyUsed, false);
  room.players.a.state.x = 530;
  assert.equal(attemptEmergency(room, 'a', 21000).ok, true);
  afterMeeting(room, 22000);
  assert.equal(attemptEmergency(room, 'a', 50000).ok, false);
  assert.equal(attemptEmergency(room, 'b', 41999).ok, false);
  assert.equal(attemptEmergency(room, 'b', 42000).ok, true);
  assert.equal(actionState(room, 'a').emergencyUsed, true);
  assert.equal(actionState(room, 'c').emergencyUsed, false);
  initializeActions(room, 60000);
  assert.equal(actionState(room, 'a').emergencyUsed, false);
});

test('body reports bypass emergency usage/cooldown but validate living reporter, corpse and range', () => {
  const room = game();
  room.actions.emergencyUsed.a = true;
  room.actions.emergencyReadyAt = 9999999;
  room.actions.bodies.first = { x: 530, y: 100 };
  assert.equal(attemptBodyReport(room, 'a', 'first').ok, true);
  room.actions.bodies = { second: { x: 530, y: 100 } };
  assert.equal(attemptBodyReport(room, 'a', 'second').ok, true);
  assert.equal(attemptBodyReport(room, 'a', 'first').ok, false);
  room.players.a.state.x = 591;
  assert.equal(attemptBodyReport(room, 'a', 'second').ok, false);
  room.players.a.state.x = 530;
  room.players.a.isAlive = false;
  assert.equal(attemptBodyReport(room, 'a', 'second').ok, false);
});

test('after a meeting, kill and emergency cooldown restart without refunding emergency usage', () => {
  const room = game();
  room.actions.emergencyUsed.a = true;
  afterMeeting(room, 50000);
  assert.equal(room.actions.killReadyAt, 70000);
  assert.equal(room.actions.emergencyReadyAt, 70000);
  assert.equal(room.actions.emergencyUsed.a, true);
});
