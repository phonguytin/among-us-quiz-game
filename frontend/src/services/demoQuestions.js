// Local fixtures only: these answers are deliberately visible in demo mode.
// Never use client-side demo grading as authoritative game progress.
export const DEMO_QUESTIONS = [
  {
    id: 'demo-choice-1', type: 'multiple-choice',
    prompt: 'Trong Among Us, ai cần hoàn thành nhiệm vụ để giúp đội của mình?',
    options: [
      { id: 'crew', text: 'Crewmate' },
      { id: 'imposter', text: 'Imposter' },
      { id: 'nobody', text: 'Không ai cả' },
    ],
    correctAnswer: 'crew',
  },
  {
    id: 'demo-text-1', type: 'text',
    prompt: 'Điền kết quả phép tính: 2 + 3 = ?',
    correctAnswer: '5',
  },
];
