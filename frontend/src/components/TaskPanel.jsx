import { useEffect, useRef, useState } from 'react';
import styles from './TaskPanel.module.css';
import { nextUnsolvedQuestion } from '../utils/questionProgress.js';

export default function TaskPanel({ task, service, onClose, onComplete }) {
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [solved, setSolved] = useState(new Set());
  const panel = useRef(null);
  const controller = useRef(null);
  const sending = useRef(false);
  const question = questions[index];

  useEffect(() => {
    const previousFocus = document.activeElement;
    panel.current?.querySelector('button')?.focus();
    return () => previousFocus?.focus?.();
  }, []);

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError('');
    service.getQuestions({ roomId: task.roomId, taskId: task.id, signal: request.signal })
      .then(data => { if (!request.signal.aborted) setQuestions(data); })
      .catch(err => { if (!request.signal.aborted) setError(err.message); })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [task.id, task.roomId, service, attempt]);

  const handleKeys = event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const submit = async event => {
    event.preventDefault();
    if (sending.current || !question || solved.has(question.id)) return;
    if (!answer.trim()) { setError('Vui lòng chọn hoặc nhập đáp án.'); return; }
    sending.current = true;
    setSubmitting(true);
    setError('');
    setResult(null);
    const signal = controller.current.signal;
    try {
      const response = await service.submitAnswer({
        roomId: task.roomId, taskId: task.id, questionId: question.id, answer, signal,
      });
      if (signal.aborted) return;
      setResult(response.result);
      if (response.result) {
        const completed = new Set([...solved, question.id]);
        setSolved(completed);
        const next = nextUnsolvedQuestion(questions, completed, index);
        if (next === -1) (onComplete || onClose)();
        else changeQuestion(next);
      }
    } catch (err) {
      if (!signal.aborted) setError(err.message);
    } finally {
      sending.current = false;
      if (!signal.aborted) setSubmitting(false);
    }
  };

  const changeQuestion = nextIndex => {
    setIndex(nextIndex);
    setAnswer('');
    setResult(null);
    setError('');
  };

  return (
    <div className={styles.backdrop}>
      <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="task-title"
        ref={panel} onKeyDown={handleKeys} onKeyUp={event => event.stopPropagation()}>
        <header className={styles.header}>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng nhiệm vụ">×</button>
          <div><h2 id="task-title">nhiệm vụ</h2><p>{task.label}</p></div>
          {service.mode === 'demo' && <span className={styles.demo}>Dữ liệu mẫu</span>}
        </header>

        <div className={styles.content} aria-busy={loading || submitting}>
          {loading && <p role="status">Đang tải câu hỏi…</p>}
          {!loading && !question && <button type="button" onClick={() => setAttempt(value => value + 1)}>Tải lại câu hỏi</button>}
          {!loading && question && <>
            <nav className={styles.tabs} aria-label="Chọn câu hỏi">
              {questions.map((item, itemIndex) => (
                <button key={item.id} type="button" disabled={submitting} aria-current={index === itemIndex ? 'step' : undefined}
                  onClick={() => changeQuestion(itemIndex)}>
                  Câu {itemIndex + 1}{solved.has(item.id) ? ' ✓' : ''}
                </button>
              ))}
            </nav>
            <form onSubmit={submit}>
              <p className={styles.counter}>Câu {index + 1} / {questions.length} · {solved.size} câu đúng</p>
              <h3 className={styles.prompt} id="question-prompt">{question.prompt}</h3>
              <fieldset className={styles.answers} disabled={submitting || solved.has(question.id)}>
                <legend className={styles.srOnly}>Đáp án</legend>
                {question.type === 'multiple-choice' ? question.options.map(option => (
                  <label className={`${styles.option} ${answer === option.id ? styles.selected : ''}`} key={option.id}>
                    <input type="radio" name="answer" value={option.id} checked={answer === option.id}
                      onChange={() => { setAnswer(option.id); setResult(null); setError(''); }} />
                    <span>{option.text}</span>
                  </label>
                )) : (
                  <label className={styles.textAnswer}>
                    <span>Nhập đáp án</span>
                    <input type="text" value={answer} maxLength={1000} autoComplete="off" aria-describedby="question-prompt"
                      onChange={event => { setAnswer(event.target.value); setResult(null); setError(''); }} />
                  </label>
                )}
              </fieldset>
              <div className={styles.footer}>
                <p className={styles.feedback} role="status" aria-live="polite">
                  {solved.has(question.id) ? 'Đúng rồi! ✓' : result === false ? 'Chưa đúng. Bạn hãy thử lại.' : ''}
                </p>
                <button type="submit" className={styles.submit} disabled={submitting || solved.has(question.id)}>
                  {submitting ? 'Đang gửi…' : 'Submit'}
                </button>
              </div>
            </form>
          </>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      </section>
    </div>
  );
}
