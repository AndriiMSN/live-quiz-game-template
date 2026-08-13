# 04. Обработка отключений и граничные случаи

## Почему отключения — это сложно

В HTTP мире каждый запрос независим. Если клиент отключился — ничего страшного, следующий запрос придёт заново.

В WebSocket мире соединение **постоянное**. Отключение означает:
- Потерю канала связи с конкретным пользователем
- Необходимость обновить состояние всех связанных сущностей (игры, комнаты)
- Уведомление остальных участников

---

## Событие `close`

```ts
ws.on('close', () => {
  handleDisconnect(ws);
});
```

Событие `close` срабатывает когда:
- Клиент закрыл вкладку браузера
- Клиент потерял интернет-соединение
- Клиент явно вызвал `ws.close()`
- Сервер вызвал `ws.close()` или `ws.terminate()`
- Произошла ошибка сети (timeout)

**Важно:** между реальным отключением и срабатыванием `close` может пройти время (TCP keepalive timeout — обычно 30-120 секунд).

---

## Что делать при отключении

### Шаг 1: Найти пользователя по WebSocket

```ts
let disconnectedUser;
for (const user of users.values()) {
  if (user.ws === ws) {
    disconnectedUser = user;
    user.ws = undefined;  // очищаем ссылку на ws
    break;
  }
}
```

**`user.ws = undefined`** — важно! Если не очистить, будем пытаться отправить сообщение на закрытое соединение.

### Шаг 2: Удалить из всех активных игр

```ts
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
```

### Шаг 3: Уведомить остальных

`broadcastUpdatePlayers` отправляет обновлённый список игроков всем в комнате. Остальные игроки видят что кто-то ушёл.

---

## Не удаляем пользователя из users

```ts
// НЕ делаем: users.delete(disconnectedUser.name);
```

Почему? Пользователь может **переподключиться** (клиент автоматически пытается reconnect). При повторном `reg` с тем же именем и паролем — он залогинится обратно.

Из клиентского кода:

```ts
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

socket.onclose = () => {
  if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts.current++;
    reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
  }
};
```

Клиент пытается переподключиться 5 раз с интервалом 2 секунды.

---

## Граничные случаи (Edge Cases)

### 1. Хост отключился

Что происходит: хост — это обычный пользователь с `game.hostId`. Его `ws` становится `undefined`.

Последствия:
- Broadcast продолжает работать (хост просто не получает сообщения)
- Если игра `"waiting"` — никто не может стартовать
- Если игра `"in_progress"` — игра продолжается (таймер на сервере)

В production стоит добавить: назначение нового хоста или завершение игры.

### 2. Все игроки отключились

Таймер продолжает работать. `processQuestionEnd` вызовется, посчитает результаты (пустые), перейдёт к следующему вопросу. В итоге игра завершится с нулевыми очками.

### 3. Игрок отключился во время ответа

Если игрок не успел ответить — его `hasAnswered` остаётся `false`. При подсчёте очков он получит 0.

Если все оставшиеся игроки уже ответили — проверка `allAnswered` может сработать раньше таймера (меньше игроков → быстрее все ответят).

### 4. Двойная регистрация с одного ws

Один WebSocket отправляет `reg` дважды. Второй `reg` перезапишет `user.ws` — безвредно, тот же сокет.

### 5. Игрок пытается join после старта

```ts
if (game.status !== 'waiting') {
  send(ws, 'error', { message: 'Game already started' });
  return;
}
```

---

## WebSocket vs TCP — что происходит при потере соединения

```
Нормальное закрытие:
Клиент → Close Frame → Сервер
Сервер → Close Frame → Клиент
Обе стороны знают что соединение закрыто
→ 'close' событие срабатывает мгновенно

Потеря интернета:
Клиент ✕ (нет связи) ✕ Сервер
Сервер не знает что клиент ушёл!
→ Только TCP keepalive timeout (30-120 сек)
→ 'close' событие срабатывает с задержкой
```

### Ping/Pong — heartbeat

Чтобы быстрее обнаруживать "мёртвые" соединения:

```ts
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});
```

Каждые 30 секунд сервер отправляет `ping`. Если через 30 секунд `pong` не пришёл — соединение мертво, закрываем принудительно.

В нашем учебном проекте этого нет, но в production — обязательно.

---

## Памятка: что проверять в каждом handler

```
1. Пользователь зарегистрирован?     → findUserByWs(ws)
2. Игра существует?                   → games.get(gameId)
3. Правильный статус игры?            → game.status === 'waiting' / 'in_progress'
4. Пользователь имеет право?          → game.hostId === user.index
5. Пользователь в этой игре?          → game.players.find(...)
6. Действие не дублируется?           → player.hasAnswered
7. Индексы в допустимых диапазонах?   → correctIndex 0-3
```

---

## Итог по всем 4 конспектам

| Конспект | Ключевые концепции |
|----------|--------------------|
| 01 | WebSocket протокол, handshake, ws библиотека, формат сообщений |
| 02 | Room паттерн, broadcast/unicast, state machine, guard clauses |
| 03 | setTimeout/clearTimeout, scoring формула, Date.now(), race conditions |
| 04 | Disconnect handling, edge cases, ping/pong heartbeat |

Эти концепции используются не только в quiz-игре, но и в:
- Чатах (Slack, Discord)
- Совместном редактировании (Google Docs, Figma)
- Онлайн-играх
- Финансовых приложениях (биржевые данные в реальном времени)
- IoT (управление устройствами)
