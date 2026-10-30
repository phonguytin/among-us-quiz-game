// sessionStorage may be copied when a tab is duplicated or opened by another
// tab. A new page must own a fresh identity instead of reusing that copied ID.
export function createPlayerIdentity(storage, generateId) {
  const playerId = generateId();
  storage.setItem('playerId', playerId);
  return () => playerId;
}
