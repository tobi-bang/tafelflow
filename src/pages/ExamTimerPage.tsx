import { useLocation } from 'react-router-dom';
import ExamTimerTool from '../features/examTimer/ExamTimerTool';

/** Nur Lehrkräfte erreichen diese Seite (siehe App.tsx). Board-Deep-Link z. B. /pruefungstimer/board */
export default function ExamTimerPage() {
  const { pathname } = useLocation();
  const initialOpenBoard = /\/(pruefungstimer|pruefungsplaner)\/board\/?$/i.test(pathname);
  return <ExamTimerTool initialOpenBoard={initialOpenBoard} />;
}
