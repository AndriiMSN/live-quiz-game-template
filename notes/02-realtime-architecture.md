# 02. Real-time архитектура: комнаты, broadcast, управление игрой

## Паттерн "Комната" (Room)

В real-time приложениях (чаты, игры, совместное редактирование) используется паттерн **Room** — логическая группа соединений, которые получают одинаковые сообщения.

```
Room "ABC123"
├── Host (WebSocket #1)
├── Player 1 (WebSocket #2)
├── Player 2 (WebSocket #3)
└── Player 3 (WebSocket #4)

Broadcast → сообщение уходит всем 4 соединениям
```

В нашем проекте "комната" — это `Game`:

```ts
interface Game {
  id: string;           // уникальный ID игры
  code: string;         // 6-символьный код для входа (ABC123)
  hostId: string;       // кто создал игру
  players: Player[];    // кто присоединился
  // ...
}
```

---

## Два типа хранилищ

### `games: Map<string, Game>` — по ID

```ts
games.get('550e8400-e29b-41d4-a716-446655440000') → Game
```

Используется когда уже знаем ID игры (из предыдущих сообщений).

### `gamesByCode: Map<string, string>` — по коду

```ts
gamesByCode.get('ABC123') → '550e8400-e29b-41d4-a716-446655440000'
```

Код нужен для **join** — игрок вводит 6 символов, а не UUID. Это lookup таблица: код → ID.

**Зачем два хранилища?**
- ID — для внутренней логики (надёжный, уникальный)
- Код — для пользователя (короткий, легко ввести)

---

## Создание игры (create_game)

### Что происходит

1. Хост отправляет список вопросов
2. Сервер валидирует вопросы
3. Генерирует уникальный ID и 6-символьный код
4. Создаёт объект Game со статусом `"waiting"`
5. Отвечает хосту: `{ gameId, code }`

### Валидация вопросов

```ts
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
```

**Почему валидация на сервере обязательна?**
- Клиент может быть модифицирован (инструменты разработчика, кастомный клиент)
- Некорректные данные могут сломать игровой процесс
- Правило: **никогда не доверяй входящим данным**

---

## Присоединение к игре (join_game)

### Поток данных

```
Player              Server                Host + другие Player-ы
  │                   │                          │
  │── join_game ────►│                          │
  │   {code:"ABC123"} │                          │
  │                   │                          │
  │◄── game_joined ──│                          │
  │   {gameId:"..."}  │                          │
  │                   │                          │
  │                   │── player_joined ────────►│
  │                   │   {playerName, count}     │
  │                   │                          │
  │◄── update_players│── update_players ────────►│
  │   [{name,index,   │   (тот же массив)        │
  │     score}]        │                          │
```

### Три ответа на один запрос

Это ключевое отличие WebSocket от REST: один запрос от игрока порождает **три** сообщения:

1. **`game_joined`** → только отправителю (личный ответ)
2. **`player_joined`** → всем в комнате (оповещение)
3. **`update_players`** → всем в комнате (обновлённый список)

### Получение всех сокетов комнаты

```ts
function getGameSockets(game: Game): WebSocket[] {
  const sockets: WebSocket[] = [];
  // Находим WebSocket хоста
  const host = users.get(/* ... */);
  if (host?.ws) sockets.push(host.ws);
  // Добавляем WebSocket-ы всех игроков
  for (const player of game.players) {
    if (player.ws) sockets.push(player.ws);
  }
  return sockets;
}
```

---

## Старт игры (start_game)

### Проверки безопасности

```ts
// Только зарегистрированный пользователь
const user = findUserByWs(ws);
if (!user) { ... }

// Только хост может стартовать
if (game.hostId !== user.index) { ... }

// Только из статуса "waiting"
if (game.status !== 'waiting') { ... }
```

### Что происходит при старте

```ts
game.status = 'in_progress';
game.currentQuestion = 0;
sendQuestion(game);
```

Меняем статус и отправляем **первый вопрос** всем участникам.

---

## Паттерн "Найти пользователя по WebSocket"

```ts
function findUserByWs(ws: WebSocket) {
  for (const user of users.values()) {
    if (user.ws === ws) return user;
  }
  return undefined;
}
```

**Зачем это нужно?** WebSocket сообщение приходит от конкретного `ws` соединения. Но нам нужно знать **кто** отправил — какой пользователь, в какой он игре, является ли хостом.

**Альтернатива (Map<WebSocket, User>):**

```ts
const wsToUser: Map<WebSocket, User> = new Map();
```

Это даёт O(1) поиск вместо O(n), но добавляет необходимость синхронизировать два хранилища. Для учебного проекта линейный поиск приемлем.

---

## Статус игры — State Machine

Игра имеет три состояния:

```
"waiting" ──── start_game ────► "in_progress" ──── last question ────► "finished"
    │                                │
    │ join_game ✅                   │ join_game ❌
    │ start_game ✅                  │ start_game ❌
    │ answer ❌                      │ answer ✅
```

**State Machine** — это паттерн где объект имеет конечное число состояний и определённые переходы между ними.

```ts
type GameStatus = 'waiting' | 'in_progress' | 'finished';
```

Каждая команда проверяет текущий статус:
- `join_game` — только `"waiting"`
- `start_game` — только `"waiting"`
- `answer` — только `"in_progress"`

---

## Broadcast vs Unicast vs Multicast

| Тип | Кому отправляется | Пример |
|-----|-------------------|--------|
| **Unicast** | Одному конкретному | `game_joined` → только отправителю |
| **Multicast** | Группе (комнате) | `player_joined` → всем в игре |
| **Broadcast** | Всем подключённым | Не используется в нашем проекте |

В нашем коде:
- `send(ws, ...)` — unicast
- `broadcast(sockets, ...)` — multicast (всем сокетам комнаты)

---

## Генерация кода комнаты

```ts
function generateCode(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}
```

Пошагово:
1. `crypto.randomBytes(3)` → `<Buffer a1 b2 c3>` (3 случайных байта)
2. `.toString('hex')` → `'a1b2c3'` (hex представление)
3. `.toUpperCase()` → `'A1B2C3'`
4. `.slice(0, 6)` → `'A1B2C3'` (гарантируем 6 символов)

**Коллизии:** С 6 hex символами есть 16^6 = 16,777,216 возможных кодов. Для учебного проекта вероятность коллизии ничтожна. В production нужна проверка уникальности.

---

## Обработка ошибок — паттерн "Guard Clause"

Каждый handler начинается с проверок (guard clauses):

```ts
export function handleJoinGame(ws, data) {
  const user = findUserByWs(ws);
  if (!user) {
    send(ws, 'error', { message: 'You must register first' });
    return;  // ← ранний выход
  }

  const gameId = gamesByCode.get(code);
  if (!gameId) {
    send(ws, 'error', { message: 'Game not found' });
    return;  // ← ранний выход
  }

  // ... основная логика (только если все проверки прошли)
}
```

**Guard Clause** — вместо вложенных `if/else` делаем ранний `return` при ошибке. Код становится плоским и читаемым.

---

## Что дальше

→ Читай `03-timers-scoring-gameflow.md` — серверные таймеры, подсчёт очков, полный цикл игры
