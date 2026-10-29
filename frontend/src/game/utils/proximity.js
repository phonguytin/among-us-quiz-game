export function nearestInRange(player, targets, defaultRadius) {
  if (!player || player.alive === false || player.active === false) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const target of targets) {
    if (target.active === false || target.reported) continue;
    const distance = Math.hypot(player.x - target.x, player.y - target.y);
    if (distance <= (target.radius ?? defaultRadius) && distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  return nearest;
}
