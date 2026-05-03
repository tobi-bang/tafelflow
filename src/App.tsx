import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import TeacherDashboard from './pages/TeacherDashboard';
import SessionView from './pages/SessionView';
import Home from './pages/Home';
import StudentJoin from './pages/StudentJoin';
import LoginTeacher from './pages/LoginTeacher';
import RegisterTeacher from './pages/RegisterTeacher';
import AuthCallback from './pages/AuthCallback';
import ExamTimerPage from './pages/ExamTimerPage';
import SupabaseConfigMissing from './components/SupabaseConfigMissing';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { requireTeacher } from './lib/role';

function hasSession(u: SupabaseUser | null): boolean {
  return Boolean(u?.id);
}

function TeacherOnlyRoute({ allowed, hasUser, children }: { allowed: boolean; hasUser: boolean; children: ReactNode }) {
  const location = useLocation();

  if (allowed) return <>{children}</>;

  const redirect = `${location.pathname}${location.search}${location.hash}`;
  const notice = hasUser ? '&notice=teacher_required' : '';
  return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}${notice}`} replace />;
}

export default function App() {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [teacherOk, setTeacherOk] = useState<boolean | null>(null);
  const [roleCheckPending, setRoleCheckPending] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false);
      return;
    }

    let cancelled = false;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setTeacherOk(null);
      setRoleCheckPending(false);
      return;
    }

    if (!user) {
      setTeacherOk(null);
      setRoleCheckPending(false);
      return;
    }

    let cancelled = false;
    setRoleCheckPending(true);
    setTeacherOk(null);

    void (async () => {
      try {
        const ok = await requireTeacher();
        if (!cancelled) {
          setTeacherOk(ok);
          setRoleCheckPending(false);
        }
      } catch {
        if (!cancelled) {
          setTeacherOk(false);
          setRoleCheckPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!isSupabaseConfigured) {
    return <SupabaseConfigMissing />;
  }

  if (authLoading || (hasSession(user) && (roleCheckPending || teacherOk === null))) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  const teacherRouteAllowed = hasSession(user) && teacherOk === true;

  return (
    <Router>
      <div className="min-h-dvh bg-slate-50 font-sans text-slate-900">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<LoginTeacher />} />
          <Route path="/register" element={<RegisterTeacher />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="/pruefungstimer/*"
            element={
              <TeacherOnlyRoute allowed={teacherRouteAllowed} hasUser={hasSession(user)}>
                <ExamTimerPage />
              </TeacherOnlyRoute>
            }
          />
          <Route
            path="/pruefungsplaner/*"
            element={
              <TeacherOnlyRoute allowed={teacherRouteAllowed} hasUser={hasSession(user)}>
                <ExamTimerPage />
              </TeacherOnlyRoute>
            }
          />
          <Route
            path="/teacher"
            element={
              <TeacherOnlyRoute allowed={teacherRouteAllowed} hasUser={hasSession(user)}>
                <TeacherDashboard />
              </TeacherOnlyRoute>
            }
          />
          <Route path="/session/:sessionId" element={<SessionView />} />
          <Route path="/join" element={<StudentJoin />} />
          <Route path="/join/session/:sessionId" element={<StudentJoin />} />
          <Route path="/student/:roomCode" element={<StudentJoin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}
