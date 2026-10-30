import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestLivingPlayer } from '../src/game/utils/killTarget.js';
import { localActionState, secondsRemaining } from '../src/game/utils/actionState.js';
import { nextUnsolvedQuestion } from '../src/utils/questionProgress.js';

test('question progression advances automatically, skips solved questions and completes only when all are solved', () => {
  const questions = [{id:'a'},{id:'b'},{id:'c'}];
  assert.equal(nextUnsolvedQuestion(questions, new Set(['a']), 0), 1);
  assert.equal(nextUnsolvedQuestion(questions, new Set(['b']), 1), 2);
  assert.equal(nextUnsolvedQuestion(questions, new Set(['b','c']), 2), 0);
  assert.equal(nextUnsolvedQuestion(questions, new Set(['a','b','c']), 2), -1);
  assert.equal(nextUnsolvedQuestion([{id:'a'}], new Set(['a']), 0), -1);
});

test('kill target is recomputed from live players and never selects self, a corpse or a destroyed sprite', () => {
  const player = {x:0,y:0,alive:true,active:true};
  const dead = {x:1,y:0,alive:false,active:true};
  const destroyed = {x:2,y:0,alive:true,active:false};
  const near = {x:10,y:0,alive:true,active:true};
  const far = {x:40,y:0,alive:true,active:true};
  const players = {player,dead,destroyed,near,far};
  assert.equal(nearestLivingPlayer(player,players,60),near);
  near.x = 55;
  assert.equal(nearestLivingPlayer(player,players,60),far);
  far.alive = false;
  near.active = false;
  assert.equal(nearestLivingPlayer(player,players,60),null);
});

test('cooldown display compensates for client/server clock differences and rounds countdown up', () => {
  const state = localActionState({serverNow:1000,killReadyAt:21000,emergencyReadyAt:500,emergencyUsed:true}, 900000);
  assert.deepEqual(state,{killReadyAt:920000,emergencyReadyAt:900000,emergencyUsed:true});
  assert.equal(secondsRemaining(state.killReadyAt,900000),20);
  assert.equal(secondsRemaining(state.killReadyAt,919999),1);
  assert.equal(secondsRemaining(state.killReadyAt,920000),0);
  assert.equal(secondsRemaining(state.killReadyAt,950000),0);
});
