import type { WebSocket } from 'ws';
import type { RegData, User } from '../types.js';
import { users } from '../store.js';
import { send, generateId } from '../utils.js';

export function handleReg(ws: WebSocket, data: RegData): void {
  const { name, password } = data;

  if (!name || !password) {
    send(ws, 'reg', {
      name: name || '',
      index: '',
      error: true,
      errorText: 'Name and password are required',
    });
    return;
  }

  const existingUser = users.get(name);

  if (existingUser) {
    if (existingUser.password !== password) {
      send(ws, 'reg', {
        name,
        index: '',
        error: true,
        errorText: 'Wrong password',
      });
      return;
    }

    existingUser.ws = ws;
    send(ws, 'reg', {
      name: existingUser.name,
      index: existingUser.index,
      error: false,
      errorText: '',
    });
    return;
  }

  const newUser: User = {
    name,
    password,
    index: generateId(),
    ws,
  };

  users.set(name, newUser);

  send(ws, 'reg', {
    name: newUser.name,
    index: newUser.index,
    error: false,
    errorText: '',
  });
}
