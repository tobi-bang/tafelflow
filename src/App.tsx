import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import TeacherDashboard from './pages/TeacherDashboard';
import SessionView from './pages/SessionView';
import Home from './pages/Home';
import JoinSession from './pages/JoinSession';
import type { AppUser } from './types';
import type { User as SupabaseUser } from '@supabase/supabase-js';

function mapUser(u: SupabaseUser | null): AppUser | null {
  if (!u) return null;
  const meta = u.user_metadata as Record<string, string | undefined> | undefined;
  return {
    id: u.id,
    displayName: meta?.display_name ?? meta?.full_name ?? null,
  };
}

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(mapUser(session?.user ?? null));
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(mapUser(session?.user ?? null));
    });

    return () => subscription.unsubscribe();
  }, []);

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
          <Route path="/" element={<Home user={user} />} />
          <Route path="/teacher" element={<TeacherDashboard />} />
          <Route path="/session/:sessionId" element={<SessionView />} />
          <Route path="/join/:roomCode" element={<JoinSession />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </Router>
  );
}
