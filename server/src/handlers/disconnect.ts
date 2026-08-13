import type { WebSocket } from 'ws';
import { users, games } from '../store.js';
import { broadcastUpdatePlayers } from './game.js';

export function handleDisconnect(ws: WebSocket): void {
  let disconnectedUser;
  for (const user of users.values()) {
    if (user.ws === ws) {
      disconnectedUser = user;
      user.ws = undefined;
      break;
    }
  }

  if (!disconnectedUser) return;

  for (const game of games.values()) {
    if (game.status === 'finished') continue;

    const playerIndex = game.players.findIndex(
      (p) => p.index === disconnectedUser.index,
    );

    if (playerIndex !== -1) {
      game.players.splice(playerIndex, 1);
      broadcastUpdatePlayers(game);
    }
  }
}
