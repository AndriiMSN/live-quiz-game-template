import type { WebSocket } from 'ws';
import type { AnswerData, Game } from '../types.js';
import { games } from '../store.js';
import { send, broadcast } from '../utils.js';
import { findUserByWs, getGameSockets } from './game.js';

const BASE_POINTS = 1000;

export function sendQuestion(game: Game): void {
  const question = game.questions[game.currentQuestion];
  if (!question) return;

  game.playerAnswers.clear();
  game.questionStartTime = Date.now();

  for (const player of game.players) {
    player.hasAnswered = false;
    player.answeredCorrectly = false;
    player.answerTime = undefined;
  }

  const questionData = {
    questionNumber: game.currentQuestion + 1,
    totalQuestions: game.questions.length,
    text: question.text,
    options: question.options,
    timeLimitSec: question.timeLimitSec,
  };

  const sockets = getGameSockets(game);
  broadcast(sockets, 'question', questionData);

  game.questionTimer = setTimeout(() => {
    processQuestionEnd(game);
  }, question.timeLimitSec * 1000);
}

export function handleAnswer(ws: WebSocket, data: AnswerData): void {
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

  if (game.status !== 'in_progress') {
    send(ws, 'error', { message: 'Game is not in progress' });
    return;
  }

  if (data.questionIndex !== game.currentQuestion) {
    send(ws, 'error', { message: 'Wrong question index' });
    return;
  }

  const player = game.players.find((p) => p.index === user.index);
  if (!player) {
    send(ws, 'error', { message: 'You are not in this game' });
    return;
  }

  if (player.hasAnswered) {
    send(ws, 'error', { message: 'You already answered this question' });
    return;
  }

  player.hasAnswered = true;
  player.answerTime = Date.now();

  const question = game.questions[game.currentQuestion];
  player.answeredCorrectly = data.answerIndex === question.correctIndex;

  game.playerAnswers.set(user.index, {
    answerIndex: data.answerIndex,
    timestamp: Date.now(),
  });

  send(ws, 'answer_accepted', { questionIndex: data.questionIndex });

  const allAnswered = game.players.every((p) => p.hasAnswered);
  if (allAnswered) {
    if (game.questionTimer) {
      clearTimeout(game.questionTimer);
      game.questionTimer = undefined;
    }
    processQuestionEnd(game);
  }
}

function processQuestionEnd(game: Game): void {
  game.questionTimer = undefined;
  const question = game.questions[game.currentQuestion];
  const questionStartTime = game.questionStartTime || Date.now();
  const timeLimitMs = question.timeLimitSec * 1000;

  const playerResults = game.players.map((player) => {
    let pointsEarned = 0;

    if (player.hasAnswered && player.answeredCorrectly && player.answerTime) {
      const timeElapsed = player.answerTime - questionStartTime;
      const timeRemaining = Math.max(0, timeLimitMs - timeElapsed);
      pointsEarned = Math.round(BASE_POINTS * (timeRemaining / timeLimitMs));
    }

    player.score += pointsEarned;

    return {
      name: player.name,
      answered: player.hasAnswered || false,
      correct: player.answeredCorrectly || false,
      pointsEarned,
      totalScore: player.score,
    };
  });

  const sockets = getGameSockets(game);
  broadcast(sockets, 'question_result', {
    questionIndex: game.currentQuestion,
    correctIndex: question.correctIndex,
    playerResults,
  });

  if (game.currentQuestion + 1 < game.questions.length) {
    game.currentQuestion++;
    setTimeout(() => {
      sendQuestion(game);
    }, 3000);
  } else {
    game.status = 'finished';
    const scoreboard = [...game.players]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({
        name: p.name,
        score: p.score,
        rank: i + 1,
      }));

    broadcast(sockets, 'game_finished', { scoreboard });
  }
}
