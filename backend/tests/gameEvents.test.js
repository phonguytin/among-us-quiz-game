import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerGameEvents } from '../src/events/gameEvents.js';
import { PlayersManager } from '../src/managers/players.manager.js';
import { RoomsManager } from '../src/managers/rooms.manager.js';

test('socket actions enforce identity and cooldowns; emergency usage never blocks later body reports', context => {
  let now = 1000;
  context.mock.method(Date, 'now', () => now);
  context.mock.method(console, 'log', () => {});
  const roomId = randomUUID();
  const ids = Array.from({length:5}, () => randomUUID());
  ids.forEach((id,index) => PlayersManager.createPlayer(id, `Player ${index}`, '#c51111'));
  const room = RoomsManager.createRoom(roomId, PlayersManager.getPlayer(ids[0]));
  ids.forEach(id => RoomsManager.players.add(roomId, PlayersManager.getPlayer(id)));
  RoomsManager.startGame(roomId);
  room.imposter = ids[0];
  const broadcasts = [];
  const io = {
    sockets: {sockets:new Map()},
    to: channel => ({emit:(event,data)=>broadcasts.push({channel,event,data})}),
  };
  const clients = ids.map(id => {
    const handlers = new Map();
    const socket = {data:{playerId:id},rooms:new Set([roomId]),
      on:(event,handler)=>handlers.set(event,handler),emit:()=>{},
      to:io.to,
    };
    io.sockets.sockets.set(id,socket);
    registerGameEvents(io,socket);
    return {socket,handlers};
  });
  const invoke = (index,event,data) => {
    let response;
    clients[index].handlers.get(event)({roomId,...data},result=>{response=result;});
    return response;
  };
  try {
    assert.equal(invoke(0,'player:kill',{killerId:ids[0],playerId:ids[1]}).ok,false);
    assert.equal(invoke(2,'meeting:start',{callerId:ids[2]}).ok,false);
    now = 21000;
    assert.equal(invoke(2,'player:kill',{killerId:ids[0],playerId:ids[1]}).ok,false);
    assert.equal(invoke(0,'player:kill',{killerId:ids[0],playerId:ids[1]}).ok,true);
    assert.equal(invoke(0,'player:kill',{killerId:ids[0],playerId:ids[3]}).ok,false);
    assert.equal(invoke(2,'meeting:start',{callerId:ids[2]}).ok,true);
    assert.equal(room.currentMeeting.isActive,true);
    assert.doesNotThrow(()=>JSON.stringify(room));
    assert.equal(room.actions.emergencyUsed[ids[2]],true);
    invoke(2,'meeting:end');
    assert.equal(room.currentMeeting.isActive,false);
    assert.equal(invoke(2,'meeting:start',{callerId:ids[2]}).ok,false);
    now = 41000;
    assert.equal(invoke(0,'player:kill',{killerId:ids[0],playerId:ids[1]}).ok,false);
    assert.equal(invoke(0,'player:kill',{killerId:ids[0],playerId:ids[3]}).ok,true);
    // The caller already used the emergency button; body report still succeeds
    // during a deliberately extended emergency cooldown.
    room.actions.emergencyReadyAt = 999999;
    assert.equal(invoke(2,'body:report',{bodyId:ids[3]}).ok,true);
    assert.equal(room.currentMeeting.isActive,true);
    assert.deepEqual(room.actions.bodies,{});
    assert.equal(invoke(2,'body:report',{bodyId:ids[3]}).ok,false);
    invoke(2,'meeting:end');
    // Another corpse can be reported by the same caller, without a quota.
    room.actions.bodies[ids[1]]={id:ids[1],x:560,y:150};
    assert.equal(invoke(2,'body:report',{bodyId:ids[1]}).ok,true);
    assert.equal(broadcasts.filter(message=>message.event==='meeting:started').length,3);
    assert.equal(broadcasts.filter(message=>message.event==='player:killed').length,2);
  } finally {
    RoomsManager.meetings.end(roomId);
    ids.forEach(id => { RoomsManager.players.remove(roomId, PlayersManager.getPlayer(id)); PlayersManager.deletePlayer(id); });
  }
});
