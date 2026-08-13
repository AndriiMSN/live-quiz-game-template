import type { WebSocket } from 'ws';
import type { CreateGameData, JoinGameData, StartGameData, Game, Player } from '../types.js';
import { users, games, gamesByCode } from '../store.js';
import { send, broadcast, generateId, generateCode } from '../utils.js';
import { sendQuestion } from './play.js';

function findUserByWs(ws: WebSocket) {
  for (const user of users.values()) {
    if (user.ws === ws) return user;
  }
  return undefined;
}

function getGameSockets(game: Game): WebSocket[] {
  const sockets: WebSocket[] = [];
  const host = users.get(
    [...users.values()].find((u) => u.index === game.hostId)?.name || '',
  );
  if (host?.ws) sockets.push(host.ws);
  for (const player of game.players) {
    if (player.ws) sockets.push(player.ws);
  }
  return sockets;
}

function broadcastUpdatePlayers(game: Game): void {
  const playerList = game.players.map((p) => ({
    name: p.name,
    index: p.index,
    score: p.score,
  }));
  const sockets = getGameSockets(game);
  broadcast(sockets, 'update_players', playerList);
}

export function handleCreateGame(ws: WebSocket, data: CreateGameData): void {
  const user = findUserByWs(ws);
  if (!user) {
    send(ws, 'error', { message: 'You must register first' });
    return;
  }

  const { questions } = data;
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    send(ws, 'error', { message: 'At least one question is required' });
    return;
  }

  for (const q of questions) {
    if (
      !q.text ||
      !Array.isArray(q.options) ||
      q.options.length !== 4 ||
      typeof q.correctIndex !== 'number' ||
      q.correctIndex < 0 ||
      q.correctIndex > 3 ||
      typeof q.timeLimitSec !== 'number' ||
      q.timeLimitSec <= 0
    ) {
      send(ws, 'error', { message: 'Invalid question format' });
      return;
    }
  }

  const gameId = generateId();
  const code = generateCode();

  const game: Game = {
    id: gameId,
    code,
    hostId: user.index,
    questions,
    players: [],
    currentQuestion: -1,
    status: 'waiting',
    playerAnswers: new Map(),
  };

  games.set(gameId, game);
  gamesByCode.set(code, gameId);

  send(ws, 'game_created', { gameId, code });
}

export function handleJoinGame(ws: WebSocket, data: JoinGameData): void {
  const user = findUserByWs(ws);
  if (!user) {
    send(ws, 'error', { message: 'You must register first' });
    return;
  }

  const { code } = data;
  const gameId = gamesByCode.get(code?.toUpperCase());
  if (!gameId) {
    send(ws, 'error', { message: 'Game not found' });
    return;
  }

  const game = games.get(gameId);
  if (!game) {
    send(ws, 'error', { message: 'Game not found' });
    return;
  }

  if (game.status !== 'waiting') {
    send(ws, 'error', { message: 'Game already started' });
    return;
  }

  if (game.players.find((p) => p.index === user.index)) {
    send(ws, 'error', { message: 'You already joined this game' });
    return;
  }

  const player: Player = {
    name: user.name,
    index: user.index,
    score: 0,
    ws,
  };

  game.players.push(player);

  send(ws, 'game_joined', { gameId });

  const sockets = getGameSockets(game);
  broadcast(sockets, 'player_joined', {
    playerName: user.name,
    playerCount: game.players.length,
  });

  broadcastUpdatePlayers(game);
}

export function handleStartGame(ws: WebSocket, data: StartGameData): void {
  const user = findUserByWs(ws);
  if (!user) {
    send(ws, 'error', { message: 'You must register first' });
    return;
  }

  const game = games.get(data.gameId);
  if (!game) {
    send(ws, 'error', { message: 'Game not found' });
    return;
  }

  if (game.hostId !== user.index) {
    send(ws, 'error', { message: 'Only the host can start the game' });
    return;
  }

  if (game.status !== 'waiting') {
    send(ws, 'error', { message: 'Game already started' });
    return;
  }

  game.status = 'in_progress';
  game.currentQuestion = 0;

  sendQuestion(game);
}

export { findUserByWs, getGameSockets, broadcastUpdatePlayers };
