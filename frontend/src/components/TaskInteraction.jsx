import { useCallback, useEffect, useState } from 'react';
import { EventBus } from '../game/EventBus.js';
import { questionService } from '../services/questions.js';
import TaskPanel from './TaskPanel.jsx';
import styles from './TaskInteraction.module.css';

export default function TaskInteraction() {
  const [nearby, setNearby] = useState({ task: null, body: null });
  const [task, setTask] = useState(null);
  const [reportMessage, setReportMessage] = useState('');
  const close = useCallback(() => {
    setTask(null);
    EventBus.emit('task:close');
  }, []);

  useEffect(() => {
    const open = data => { setTask(data); setReportMessage(''); };
    const reset = () => { setTask(null); setNearby({ task: null, body: null }); };
    const report = () => setReportMessage('Report thành công. Xem console (F12).');
    EventBus.on('interaction:nearby', setNearby);
    EventBus.on('task:opened', open);
    EventBus.on('interaction:reset', reset);
    EventBus.on('body:reported', report);
    EventBus.emit('interaction:sync');
    return () => {
      EventBus.off('interaction:nearby', setNearby);
      EventBus.off('task:opened', open);
      EventBus.off('interaction:reset', reset);
      EventBus.off('body:reported', report);
      EventBus.emit('task:close');
    };
  }, []);

  useEffect(() => {
    if (!reportMessage) return;
    const timer = setTimeout(() => setReportMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [reportMessage]);

  return <>
    {!task && <div className={styles.actions} aria-label="Tương tác">
      {nearby.task && <button type="button" aria-label="Solve" onClick={() => EventBus.emit('task:open')}>
        <img src="/assets/icons/solve.svg" alt="" /><span>Solve</span>
      </button>}
      {nearby.body && <button type="button" aria-label="Report" onClick={() => EventBus.emit('body:report')}>
        <img src="/assets/icons/reportBtn.png" alt="" /><span>Report</span>
      </button>}
    </div>}
    {reportMessage && <p className={styles.reportMessage} role="status">{reportMessage}</p>}
    {task && <TaskPanel key={`${task.roomId}:${task.id}`} task={task} service={questionService} onClose={close} />}
  </>;
}
