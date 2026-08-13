# 01. WebSocket: протокол и библиотека ws

## Зачем нужен WebSocket

### Проблема HTTP

HTTP работает по модели **запрос-ответ**: клиент отправляет запрос, сервер отвечает. Сервер **не может** сам инициировать отправку данных клиенту.

```
HTTP:
Клиент: "Есть новые сообщения?" → Сервер: "Нет"
Клиент: "Есть новые сообщения?" → Сервер: "Нет"
Клиент: "Есть новые сообщения?" → Сервер: "Да, вот!"  ← задержка!
```

Это называется **polling** — клиент постоянно опрашивает сервер. Проблемы:
- Задержка (до интервала опроса)
- Лишний трафик (99% запросов бессмысленны)
- Нагрузка на сервер

### Решение: WebSocket

WebSocket — это **двунаправленное** постоянное соединение. После установки и клиент, и сервер могут отправлять данные **в любой момент**.

```
WebSocket:
Клиент ←→ Сервер (постоянное соединение)

Сервер: "Новое сообщение!" → Клиент  ← мгновенно
Клиент: "Ответ!" → Сервер            ← мгновенно
```

---

## Как устанавливается WebSocket соединение

### Handshake (рукопожатие)

WebSocket начинается как обычный HTTP запрос с заголовком `Upgrade`:

```
Клиент → Сервер (HTTP):
GET / HTTP/1.1
Host: localhost:3000
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

Сервер отвечает:

```
Сервер → Клиент (HTTP 101):
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

После этого HTTP соединение **превращается в WebSocket**. Дальше общение идёт по WebSocket протоколу (фреймы, а не HTTP запросы).

### Схема жизненного цикла

```
1. Клиент открывает TCP соединение
2. HTTP Handshake (Upgrade: websocket)
3. Сервер отвечает 101 Switching Protocols
4. ═══ WebSocket соединение установлено ═══
5. Клиент и сервер обмениваются фреймами
6. Любая сторона может закрыть соединение
```

---

## Библиотека `ws`

`ws` — самая популярная WebSocket библиотека для Node.js. Она реализует WebSocket протокол (RFC 6455) и предоставляет серверный и клиентский API.

### Создание сервера

```ts
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 3000 });

wss.on('connection', (ws) => {
  console.log('Новое подключение');

  ws.on('message', (data) => {
    console.log('Получено:', data.toString());
  });

  ws.on('close', () => {
    console.log('Отключение');
  });
});
```

### Ключевые события

| Событие | Когда срабатывает |
|---------|-------------------|
| `wss.on('connection')` | Новый клиент подключился |
| `ws.on('message')` | Получено сообщение от клиента |
| `ws.on('close')` | Клиент отключился |
| `ws.on('error')` | Ошибка соединения |

### Отправка сообщений

```ts
ws.send('Hello!');
ws.send(JSON.stringify({ type: 'reg', data: { name: 'Alice' }, id: 0 }));
```

### `readyState` — состояние соединения

```ts
ws.CONNECTING // 0 — соединение устанавливается
ws.OPEN       // 1 — соединение открыто, можно отправлять
ws.CLOSING    // 2 — соединение закрывается
ws.CLOSED     // 3 — соединение закрыто
```

Перед отправкой всегда проверяй:

```ts
if (ws.readyState === ws.OPEN) {
  ws.send(message);
}
```

---

## Формат сообщений в нашем проекте

Все сообщения — JSON строки с тремя полями:

```ts
interface WSMessage {
  type: string;   // тип команды: 'reg', 'create_game', ...
  data: any;      // данные (объект или массив)
  id: number;     // всегда 0
}
```

### Отправка (клиент → сервер)

```ts
// Клиент отправляет:
ws.send(JSON.stringify({
  type: 'reg',
  data: { name: 'Alice', password: '123' },
  id: 0
}));
```

### Получение и парсинг (на сервере)

```ts
ws.on('message', (raw: Buffer) => {
  const message = JSON.parse(raw.toString());
  const { type, data } = message;

  switch (type) {
    case 'reg':
      handleReg(ws, data);
      break;
    // ...
  }
});
```

**Важно:** `raw` приходит как `Buffer` (бинарные данные). Нужно `.toString()` чтобы превратить в строку, затем `JSON.parse()`.

---

## Регистрация / Логин — команда `reg`

### Логика

Это простейший пример аутентификации:

1. Клиент отправляет `{ name, password }`
2. Сервер проверяет:
   - Если пользователь **не существует** → создать нового
   - Если **существует** и пароль **совпадает** → залогинить (переподключить ws)
   - Если **существует** и пароль **не совпадает** → ошибка
3. Сервер отвечает с `{ name, index, error, errorText }`

### In-memory хранилище

```ts
const users: Map<string, User> = new Map();
```

`Map<string, User>` — ключ это имя пользователя (уникальное), значение — объект User.

**Почему Map а не объект?**
- `Map` имеет O(1) поиск по ключу
- `.has()`, `.get()`, `.set()` — удобный API
- Не засоряется prototype свойствами

### Привязка WebSocket к пользователю

```ts
interface User {
  name: string;
  password: string;
  index: string;    // уникальный UUID
  ws?: WebSocket;   // текущее WebSocket соединение
}
```

`ws` привязывается к пользователю при регистрации/логине. Это позволяет:
- Находить пользователя по его WebSocket соединению (`findUserByWs`)
- Отправлять сообщения конкретному пользователю через его `ws`

---

## Утилиты

### `send` — отправка сообщения одному клиенту

```ts
function send(ws: WebSocket, type: string, data: any): void {
  const message = JSON.stringify({ type, data, id: 0 });
  if (ws.readyState === ws.OPEN) {
    ws.send(message);
  }
}
```

Проверка `readyState` — обязательна! Клиент мог отключиться между моментом когда мы решили отправить сообщение и моментом отправки.

### `broadcast` — отправка всем в комнате

```ts
function broadcast(sockets: WebSocket[], type: string, data: any): void {
  for (const ws of sockets) {
    send(ws, type, data);
  }
}
```

### `generateCode` — 6-символьный код комнаты

```ts
function generateCode(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}
```

`crypto.randomBytes(3)` → 3 байта → 6 hex символов → `'A1B2C3'`

---

## Архитектура серверного кода

```
server/src/
├── index.ts              ← Точка входа: создание WSS, роутинг сообщений
├── types.ts              ← TypeScript интерфейсы (уже предоставлены)
├── store.ts              ← In-memory хранилище: users, games
├── utils.ts              ← send, broadcast, generateCode, generateId
└── handlers/
    ├── reg.ts            ← handleReg — регистрация/логин
    ├── game.ts           ← handleCreateGame, handleJoinGame, handleStartGame
    ├── play.ts           ← handleAnswer, sendQuestion, processQuestionEnd
    └── disconnect.ts     ← handleDisconnect
```

**Почему такое разделение?**
- **Single Responsibility** — каждый файл отвечает за одну область
- **Легко тестировать** — каждый handler можно тестировать отдельно
- **Легко читать** — знаешь где искать конкретную логику

---

## WebSocket vs HTTP REST API

| Характеристика | HTTP REST | WebSocket |
|----------------|-----------|-----------|
| Направление | Клиент → Сервер | Двунаправленное |
| Соединение | Новое на каждый запрос | Постоянное |
| Overhead | Заголовки на каждый запрос | Минимальный после handshake |
| Latency | Высокий (новое соединение) | Низкий (уже подключены) |
| Масштабирование | Проще (stateless) | Сложнее (stateful) |
| Использование | CRUD, API | Real-time, чаты, игры |

**Наш проект использует WebSocket потому что:**
- Нужна мгновенная доставка вопросов всем игрокам
- Сервер должен уведомлять о результатах без запроса
- Таймер на сервере должен broadcast по истечении

---

## Что дальше

→ Читай `02-realtime-architecture.md` — как организовать "комнаты", broadcast, управление игрой
