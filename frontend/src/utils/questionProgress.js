export function nextUnsolvedQuestion(questions, solved, currentIndex) {
  for (let offset = 1; offset <= questions.length; offset++) {
    const index = (currentIndex + offset) % questions.length;
    if (!solved.has(questions[index].id)) return index;
  }
  return -1;
}
