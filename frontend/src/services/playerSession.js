import { createPlayerIdentity } from '../utils/playerIdentity.js';

// One stable identity per page lifetime, also shared by all components after
// React remounts. Reloading starts a new player; Socket.IO cleans up the old one.
export const getPlayerId = createPlayerIdentity(sessionStorage, () => crypto.randomUUID());
