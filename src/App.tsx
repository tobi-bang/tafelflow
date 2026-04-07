import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import TeacherDashboard from './pages/TeacherDashboard';
import SessionView from './pages/SessionView';
import Home from './pages/Home';
import StudentJoin from './pages/StudentJoin';
import LoginTeacher from './pages/LoginTeacher';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { requireTeacher } from './lib/role';

function hasSession(u: SupabaseUser | null): boolean {
  return Boolean(u?.id);
}

export default function App() {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [teacherOk, setTeacherOk] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        setTeacherOk(null);
        return;
      }
      const ok = await requireTeacher();
      if (!cancelled) setTeacherOk(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<LoginTeacher />} />
          <Route
            path="/teacher"
            element={
              hasSession(user) && teacherOk === true ? (
                <TeacherDashboard />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route path="/session/:sessionId" element={<SessionView />} />
          <Route path="/join" element={<StudentJoin />} />
          <Route path="/student/:roomCode" element={<StudentJoin />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </Router>
  );
}
