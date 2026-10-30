import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPlayerIdentity } from '../src/utils/playerIdentity.js';

function storage(initial = []) {
  const data = new Map(initial);
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
}

test('five duplicated tabs replace the copied player ID with five independent identities', () => {
  const copiedId = 'original-player';
  const tabs = Array.from({ length: 5 }, () => storage([['playerId', copiedId]]));
  const identities = tabs.map(tab => createPlayerIdentity(tab, randomUUID));
  const ids = identities.map(getId => getId());
  assert.equal(new Set(ids).size, 5);
  assert.ok(ids.every(id => id !== copiedId));
  tabs.forEach((tab, index) => assert.equal(tab.getItem('playerId'), ids[index]));
  // Closing/disconnecting one tab must never select another tab's player ID.
  assert.ok(ids.slice(1).every(id => id !== identities[0]()));
});

test('identity stays stable for the page lifetime and a reload gets a fresh ID', () => {
  const tab = storage();
  const getId = createPlayerIdentity(tab, randomUUID);
  assert.equal(getId(), getId());
  const previous = getId();
  const reloaded = createPlayerIdentity(tab, randomUUID);
  assert.notEqual(reloaded(), previous);
  assert.equal(getId(), previous);
  assert.equal(tab.getItem('playerId'), reloaded());
});
