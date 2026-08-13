import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import 'dotenv/config';
import type { WSMessage } from './types.js';
import { handleReg } from './handlers/reg.js';
import { handleCreateGame, handleJoinGame, handleStartGame } from './handlers/game.js';
import { handleAnswer } from './handlers/play.js';
import { handleDisconnect } from './handlers/disconnect.js';
import { send } from './utils.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server is running on ws://localhost:${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  console.log('New client connected');

  ws.on('message', (raw: Buffer) => {
    try {
      const message: WSMessage = JSON.parse(raw.toString());
      const { type, data } = message;

      switch (type) {
        case 'reg':
          handleReg(ws, data);
          break;
        case 'create_game':
          handleCreateGame(ws, data);
          break;
        case 'join_game':
          handleJoinGame(ws, data);
          break;
        case 'start_game':
          handleStartGame(ws, data);
          break;
        case 'answer':
          handleAnswer(ws, data);
          break;
        default:
          send(ws, 'error', { message: `Unknown command: ${type}` });
      }
    } catch (err) {
      console.error('Failed to parse message:', err);
      send(ws, 'error', { message: 'Invalid message format' });
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});