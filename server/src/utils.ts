import type { WebSocket } from 'ws';
import crypto from 'node:crypto';

export function send(ws: WebSocket, type: string, data: any): void {
  const message = JSON.stringify({ type, data, id: 0 });
  if (ws.readyState === ws.OPEN) {
    ws.send(message);
  }
}

export function broadcast(sockets: WebSocket[], type: string, data: any): void {
  for (const ws of sockets) {
    send(ws, type, data);
  }
}

export function generateCode(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}

export function generateId(): string {
  return crypto.randomUUID();
}
