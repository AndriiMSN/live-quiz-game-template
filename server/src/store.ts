import type { User, Game } from './types.js';

export const users: Map<string, User> = new Map();
export const games: Map<string, Game> = new Map();
export const gamesByCode: Map<string, string> = new Map();
