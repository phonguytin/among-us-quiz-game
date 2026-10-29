import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestInRange } from '../src/game/utils/proximity.js';
import { createQuestionService } from '../src/services/questionService.js';

test('proximity selects closest usable target, including exact range boundary', () => {
  const player = { x: 0, y: 0, alive: true, active: true };
  const near = { id: 'near', x: 3, y: 4 };
  const far = { id: 'far', x: 6, y: 0 };
  assert.equal(nearestInRange(player, [far, near], 5), near);
  assert.equal(nearestInRange(player, [{ ...near, reported: true }, far], 5), null);
  assert.equal(nearestInRange(player, [{ ...near, active: false }], 5), null);
  assert.equal(nearestInRange({ ...player, alive: false }, [near], 5), null);
  assert.equal(nearestInRange({ ...player, active: false }, [near], 5), null);
  assert.equal(nearestInRange(player, [{ ...near, radius: 4 }], 60), null);
});

test('demo supports choice/text, true/false, and does not expose answer fields in question payload', async () => {
  const service = createQuestionService();
  const questions = await service.getQuestions({ roomId: 'room', taskId: 'task' });
  assert.deepEqual(questions.map(q => q.type), ['multiple-choice', 'text']);
  assert.ok(questions.every(q => !('correctAnswer' in q)));
  const context = { roomId: 'room', taskId: 'task' };
  assert.deepEqual(await service.submitAnswer({ ...context, questionId: questions[0].id, answer: 'crew' }), { result: true });
  assert.deepEqual(await service.submitAnswer({ ...context, questionId: questions[0].id, answer: 'imposter' }), { result: false });
  assert.deepEqual(await service.submitAnswer({ ...context, questionId: questions[1].id, answer: ' 5 ' }), { result: true });
  await assert.rejects(service.submitAnswer({ ...context, questionId: questions[1].id, answer: '  ' }), /chọn hoặc nhập/);
  await assert.rejects(service.submitAnswer({ ...context, questionId: 'missing', answer: '5' }), /Không tìm thấy/);
});

test('API encodes context and posts question ID + answer; only boolean result is accepted', async () => {
  const calls = [];
  const service = createQuestionService({ mode: 'api', baseUrl: 'https://quiz.example/quiz/', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => options.method === 'POST' ? { result: false }
      : { questions: [{ id: 'q1', type: 'text', prompt: '2 + 3?' }] } };
  } });
  const context = { roomId: 'A B&', taskId: 'task/1' };
  await service.getQuestions(context);
  assert.equal(calls[0].url, 'https://quiz.example/quiz/questions?roomId=A+B%26&taskId=task%2F1');
  assert.deepEqual(await service.submitAnswer({ ...context, questionId: 'q1', answer: '5' }), { result: false });
  assert.equal(calls[1].url, 'https://quiz.example/quiz/answers');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { ...context, questionId: 'q1', answer: '5' });
  for (const result of ['false', 0, null, undefined]) {
    const malformed = createQuestionService({ mode: 'api', fetchImpl: async () => ({ ok: true, json: async () => ({ result }) }) });
    await assert.rejects(malformed.submitAnswer({ ...context, questionId: 'q1', answer: '5' }), /boolean/);
  }
});

test('API reports unavailable/malformed questions and HTTP/network errors without switching to demo', async () => {
  for (const data of [{ questions: [] }, { questions: [{ id: 'q', prompt: 'hi', type: 'unsupported' }] },
    { questions: [{ id: 'q', prompt: 'hi', type: 'multiple-choice', options: [] }] }]) {
    const service = createQuestionService({ mode: 'api', fetchImpl: async () => ({ ok: true, json: async () => data }) });
    await assert.rejects(service.getQuestions({ roomId: 'r', taskId: 't' }));
  }
  const offline = createQuestionService({ mode: 'api', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline.getQuestions({ roomId: 'r', taskId: 't' }), /Không kết nối/);
  const unavailable = createQuestionService({ mode: 'api', fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(unavailable.getQuestions({ roomId: 'r', taskId: 't' }), /503/);
});

test('closing a task aborts in-flight API requests and demo requests honor aborted signals', async () => {
  const controller = new AbortController();
  const service = createQuestionService({ mode: 'api', fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) });
  const pending = service.getQuestions({ roomId: 'r', taskId: 't', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(createQuestionService().getQuestions({ roomId: 'r', taskId: 't', signal: controller.signal }), { name: 'AbortError' });
});
