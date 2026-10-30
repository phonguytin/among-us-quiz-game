import { nearestInRange } from './proximity.js';

export function nearestLivingPlayer(player, players, radius) {
  return nearestInRange(player, Object.values(players).filter(target =>
    target !== player && target.alive === true && target.active === true), radius);
}
