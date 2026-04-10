import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { requireTeacher } from '../lib/role';

/**
 * OAuth / E-Mail-Bestätigung (PKCE): Supabase leitet mit ?code= hierher.
 * In Supabase Dashboard → Authentication → URL Configuration → Redirect URLs die Produktions-URL ergänzen.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState('Anmeldung wird abgeschlossen…');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (cancelled) return;
        if (error) {
          setMessage('Anmeldung fehlgeschlagen.');
          navigate(`/login?error=${encodeURIComponent(error.message)}`, { replace: true });
          return;
        }
        const ok = await requireTeacher();
        if (cancelled) return;
        if (ok) {
          navigate('/teacher', { replace: true });
        } else {
          navigate('/login?notice=no_teacher', { replace: true });
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Unbekannter Fehler';
        navigate(`/login?error=${encodeURIComponent(msg)}`, { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        <p className="text-slate-600 text-sm">{message}</p>
      </div>
    </div>
  );
}
