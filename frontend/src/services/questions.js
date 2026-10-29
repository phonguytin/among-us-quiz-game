import { createQuestionService } from './questionService.js';
import { apiUrl } from '../utils/urls.js';

export const questionService = createQuestionService({
  mode: import.meta.env.VITE_QUIZ_MODE || 'demo',
  baseUrl: apiUrl('/quiz'),
});
