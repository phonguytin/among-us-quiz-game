function validateQuestions(data) {
  if (!Array.isArray(data?.questions) || data.questions.length === 0) {
    throw new Error('Chưa có câu hỏi cho nhiệm vụ này.');
  }
  const ids = new Set();
  for (const question of data.questions) {
    if (!question || typeof question.id !== 'string' || !question.id || ids.has(question.id)
      || typeof question.prompt !== 'string' || !question.prompt.trim()
      || !['multiple-choice', 'text'].includes(question.type)) {
      throw new Error('Dữ liệu câu hỏi không hợp lệ.');
    }
    ids.add(question.id);
    if (question.type === 'multiple-choice') {
      const options = question.options;
      if (!Array.isArray(options) || options.length < 2
        || options.some(option => !option || typeof option.id !== 'string' || !option.id || typeof option.text !== 'string')
        || new Set(options.map(option => option.id)).size !== options.length) {
        throw new Error('Dữ liệu lựa chọn không hợp lệ.');
      }
    }
  }
  return data.questions;
}

export function createQuestionService({ mode = 'demo', baseUrl = '/quiz', fetchImpl = globalThis.fetch } = {}) {
  if (!['demo', 'api'].includes(mode)) throw new Error('VITE_QUIZ_MODE phải là demo hoặc api.');
  const endpoint = baseUrl.replace(/\/$/, '');

  async function request(path, options, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 10000);
    try {
      const response = await fetchImpl(`${endpoint}${path}`, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`Không gửi được yêu cầu (${response.status}). Vui lòng thử lại.`);
      return await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      if (controller.signal.aborted) throw new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
      if (error instanceof TypeError) throw new Error('Không kết nối được máy chủ. Vui lòng thử lại.');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return {
    mode,
    async getQuestions({ roomId, taskId, signal }) {
      if (mode === 'demo') {
        const { DEMO_QUESTIONS } = await import('./demoQuestions.js');
        signal?.throwIfAborted();
        return validateQuestions({ questions: DEMO_QUESTIONS.map(({ correctAnswer, ...question }) => question) });
      }
      const query = new URLSearchParams({ roomId, taskId });
      return validateQuestions(await request(`/questions?${query}`, {}, signal));
    },
    async submitAnswer({ roomId, taskId, questionId, answer, signal }) {
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('Vui lòng chọn hoặc nhập đáp án.');
      const payload = { roomId, taskId, questionId, answer: answer.trim() };
      if (mode === 'demo') {
        const { DEMO_QUESTIONS } = await import('./demoQuestions.js');
        signal?.throwIfAborted();
        const question = DEMO_QUESTIONS.find(item => item.id === questionId);
        if (!question) throw new Error('Không tìm thấy câu hỏi.');
        return { result: payload.answer.toLocaleLowerCase('vi') === question.correctAnswer.toLocaleLowerCase('vi') };
      }
      const data = await request('/answers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }, signal);
      if (typeof data?.result !== 'boolean') throw new Error('Phản hồi phải chứa result kiểu boolean.');
      return { result: data.result };
    },
  };
}
