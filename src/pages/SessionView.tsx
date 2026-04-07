import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { rowToSession } from '../lib/dbMap';
import type { Session, SessionPermissions } from '../types';
import {
  Settings,
  Presentation,
  ClipboardList,
  Cloud,
  Share2,
  ChevronLeft,
  Download,
  Lock,
  Unlock,
  X,
  BarChart3,
  Maximize2,
  Minimize2,
  FileText,
  ImageDown,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  buildProtocolText,
  downloadProtocolPdf,
  downloadTextFile,
  fetchSessionExportData,
  safeExportBasename,
} from '../lib/sessionExport';
import Board from '../components/Board';
import Brainstorming from '../components/Brainstorming';
import Polls from '../components/Polls';
import WordCloud from '../components/WordCloud';

type Tab = 'board' | 'brainstorming' | 'polls' | 'wordcloud';

const ALL_TABS: Tab[] = ['board', 'brainstorming', 'polls', 'wordcloud'];

/** SuS sehen nur Bereiche, die in den Sitzungseinstellungen freigeschaltet sind. */
function visibleTabsForStudent(p: SessionPermissions): Tab[] {
  const tabs: Tab[] = [];
  if (p.drawBoard) tabs.push('board');
  if (p.addSticky || p.moveSticky || p.organizeBrainstorm) tabs.push('brainstorming');
  if (p.answerPoll) tabs.push('polls');
  if (p.submitWord) tabs.push('wordcloud');
  return tabs;
}

const TAB_META: Record<Tab, { label: string; icon: React.ReactNode }> = {
  board: { label: 'Tafel', icon: <Presentation className="w-6 h-6" /> },
  brainstorming: { label: 'Ideen', icon: <ClipboardList className="w-6 h-6" /> },
  polls: { label: 'Umfrage', icon: <BarChart3 className="w-6 h-6" /> },
  wordcloud: { label: 'Wortwolke', icon: <Cloud className="w-6 h-6" /> },
};

export default function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [isTeacher, setIsTeacher] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('board');
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportBusy, setExportBusy] = useState<'pdf' | 'txt' | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const navigate = useNavigate();
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u || cancelled) return;
      const { data: mem } = await supabase
        .from('session_members')
        .select('role')
        .eq('session_id', sessionId)
        .eq('user_id', u.id)
        .maybeSingle();
      if (!cancelled) setIsTeacher(mem?.role === 'teacher');
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const load = async () => {
      const { data, error } = await supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle();
      if (error || !data) {
        navigate('/');
        return;
      }
      const s = rowToSession(data as Record<string, unknown>);
      if (s) setSession(s);
      else navigate('/');
    };

    load();

    const channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${sessionId}`,
        },
        async () => {
          const { data } = await supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle();
          if (data) {
            const s = rowToSession(data as Record<string, unknown>);
            if (s) setSession(s);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, navigate]);

  const togglePermission = async (permission: keyof Session['permissions']) => {
    if (!session || !isTeacher) return;
    const newPermissions = { ...session.permissions, [permission]: !session.permissions[permission] };
    const { error } = await supabase.from('sessions').update({ permissions: newPermissions }).eq('id', session.id);
    if (error) console.error(error);
  };

  const toggleSessionLock = async () => {
    if (!session || !isTeacher) return;
    const newStatus = session.status === 'active' ? 'locked' : 'active';
    const { error } = await supabase.from('sessions').update({ status: newStatus }).eq('id', session.id);
    if (error) console.error(error);
  };

  const togglePresentationMode = async () => {
    if (!session || !isTeacher) return;
    const next = !session.presentationMode;
    const { error } = await supabase
      .from('sessions')
      .update({ presentation_mode: next })
      .eq('id', session.id);
    if (error) console.error(error);
  };

  const toggleBrowserFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.error(e);
    }
  };

  /** Screenshot der aktuellen Hauptfläche (am zuverlässigsten mit Reiter „Tafel“). */
  const handleExportBoardSnapshot = async () => {
    if (!boardRef.current || isExporting || !session) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(boardRef.current, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${safeExportBasename(session.name)}-Tafel.pdf`);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportProtocolPdf = async () => {
    if (!sessionId || !session || exportBusy) return;
    const join = `${window.location.origin}/join/${session.room_code}`;
    setExportBusy('pdf');
    try {
      const bundle = await fetchSessionExportData(sessionId);
      const text = buildProtocolText(session.name, session.room_code, join, bundle);
      downloadProtocolPdf(session.name, text);
    } catch (e) {
      console.error(e);
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportProtocolTxt = async () => {
    if (!sessionId || !session || exportBusy) return;
    const join = `${window.location.origin}/join/${session.room_code}`;
    setExportBusy('txt');
    try {
      const bundle = await fetchSessionExportData(sessionId);
      const text = buildProtocolText(session.name, session.room_code, join, bundle);
      downloadTextFile(text, `${safeExportBasename(session.name)}-Protokoll.txt`);
    } catch (e) {
      console.error(e);
    } finally {
      setExportBusy(null);
    }
  };

  const participantTabs = useMemo(() => {
    if (!session) return ALL_TABS;
    if (isTeacher) return ALL_TABS;
    return visibleTabsForStudent(session.permissions);
  }, [session, isTeacher]);

  const showSideNav = Boolean(session && (isTeacher || participantTabs.length > 1));

  useEffect(() => {
    if (!session || isTeacher) return;
    const tabs = visibleTabsForStudent(session.permissions);
    if (tabs.length === 0) return;
    if (!tabs.includes(activeTab)) {
      setActiveTab(tabs[0]);
    }
  }, [session, isTeacher, activeTab]);

  if (!session) return null;

  const joinPath = `/join/${session.room_code}`;
  const joinUrl = `${window.location.origin}${joinPath}`;

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={() => navigate(isTeacher ? '/teacher' : '/')}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex flex-col min-w-0">
            <h1 className="text-lg font-bold text-slate-900 leading-none truncate">{session.name}</h1>
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wider mt-1">
              {isTeacher ? `Lehrkraft · Raumcode ${session.room_code}` : 'Teilnahme'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowShare(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl font-semibold hover:bg-blue-100 transition-colors"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Teilen</span>
          </button>

          {isTeacher && (
            <>
              <button
                type="button"
                onClick={togglePresentationMode}
                className={`hidden md:flex items-center gap-2 px-3 py-2 rounded-xl font-semibold transition-colors ${
                  session.presentationMode
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title="Präsentationsmodus für Beamer/Tafel"
              >
                <Presentation className="w-4 h-4" />
                <span className="text-sm">Tafel</span>
              </button>
              <button
                type="button"
                onClick={toggleBrowserFullscreen}
                className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-600"
                title="Vollbild (Browser)"
              >
                {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={() => setShowExportModal(true)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-700 font-semibold text-sm"
                title="Ergebnisse speichern & teilen"
              >
                <Download className="w-5 h-5" />
                <span className="hidden lg:inline">Speichern</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-600"
              >
                <Settings className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {showSideNav && (
          <nav className="w-[4.5rem] sm:w-20 bg-white border-r border-slate-200 flex flex-col items-center py-4 sm:py-6 gap-4 sm:gap-6 shrink-0 overflow-y-auto">
            {(isTeacher ? ALL_TABS : participantTabs).map((tab) => (
              <NavIcon
                key={tab}
                active={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                icon={TAB_META[tab].icon}
                label={TAB_META[tab].label}
              />
            ))}
          </nav>
        )}

        <main className="flex-1 relative overflow-hidden bg-slate-100 min-w-0" ref={boardRef}>
          {!isTeacher && participantTabs.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-600 z-10 bg-slate-50">
              <p className="font-semibold text-slate-800 text-lg">Für dich ist gerade nichts freigeschaltet</p>
              <p className="text-sm mt-3 max-w-sm">
                Die Lehrkraft kann unter Sitzungseinstellungen bei <strong>Nutzung für SuS</strong> Tafel, Ideen,
                Umfrage oder Wortwolke aktivieren.
              </p>
            </div>
          )}
          <AnimatePresence mode="wait">
            {activeTab === 'board' && participantTabs.includes('board') && (
              <motion.div
                key="board"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full bg-white shadow-inner"
              >
                <Board
                  sessionId={session.id}
                  isTeacher={isTeacher}
                  permissions={session.permissions}
                  presentationMode={session.presentationMode}
                />
              </motion.div>
            )}
            {activeTab === 'brainstorming' && participantTabs.includes('brainstorming') && (
              <motion.div
                key="brainstorming"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full"
              >
                <Brainstorming
                  sessionId={session.id}
                  isTeacher={isTeacher}
                  permissions={session.permissions}
                  presentationMode={session.presentationMode}
                />
              </motion.div>
            )}
            {activeTab === 'polls' && participantTabs.includes('polls') && (
              <motion.div
                key="polls"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full p-8 overflow-y-auto"
              >
                <Polls
                  sessionId={session.id}
                  isTeacher={isTeacher}
                  permissions={session.permissions}
                  presentationMode={session.presentationMode}
                />
              </motion.div>
            )}
            {activeTab === 'wordcloud' && participantTabs.includes('wordcloud') && (
              <motion.div
                key="wordcloud"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full p-8"
              >
                <WordCloud
                  sessionId={session.id}
                  isTeacher={isTeacher}
                  permissions={session.permissions}
                  presentationMode={session.presentationMode}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {showExportModal && isTeacher && session && (
        <Modal onClose={() => setShowExportModal(false)} title="Ergebnisse festhalten">
          <p className="text-slate-600 text-sm mb-6">
            Protokoll enthält Ideen (mit Überschriften), Umfrage-Auszählung und Wortwolke. Die Dateien
            landen in deinem Download-Ordner – von dort kannst du sie per E-Mail, Cloud oder LMS an die SuS
            schicken.
          </p>
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleExportProtocolPdf}
              disabled={exportBusy !== null}
              className="w-full flex items-center gap-3 p-4 rounded-2xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 text-left transition-all disabled:opacity-50"
            >
              {exportBusy === 'pdf' ? (
                <Loader2 className="w-6 h-6 text-blue-600 shrink-0 animate-spin" />
              ) : (
                <FileText className="w-6 h-6 text-blue-600 shrink-0" />
              )}
              <div>
                <div className="font-bold text-slate-900">Sitzungsprotokoll als PDF</div>
                <div className="text-xs text-slate-500">Zum Archivieren und Drucken</div>
              </div>
            </button>
            <button
              type="button"
              onClick={handleExportProtocolTxt}
              disabled={exportBusy !== null}
              className="w-full flex items-center gap-3 p-4 rounded-2xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 text-left transition-all disabled:opacity-50"
            >
              {exportBusy === 'txt' ? (
                <Loader2 className="w-6 h-6 text-emerald-600 shrink-0 animate-spin" />
              ) : (
                <FileText className="w-6 h-6 text-emerald-600 shrink-0" />
              )}
              <div>
                <div className="font-bold text-slate-900">Sitzungsprotokoll als Text (.txt)</div>
                <div className="text-xs text-slate-500">Einfach weiterleiten, öffnet überall</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                void handleExportBoardSnapshot();
              }}
              disabled={isExporting || activeTab !== 'board'}
              className="w-full flex items-center gap-3 p-4 rounded-2xl border border-slate-200 hover:border-amber-300 hover:bg-amber-50/50 text-left transition-all disabled:opacity-50"
            >
              {isExporting ? (
                <Loader2 className="w-6 h-6 text-amber-600 shrink-0 animate-spin" />
              ) : (
                <ImageDown className="w-6 h-6 text-amber-600 shrink-0" />
              )}
              <div>
                <div className="font-bold text-slate-900">Tafel als PDF (Screenshot)</div>
                <div className="text-xs text-slate-500">
                  {activeTab === 'board'
                    ? 'Zeichnungen der aktuellen Tafel-Ansicht'
                    : 'Bitte zuerst den Reiter „Tafel“ öffnen'}
                </div>
              </div>
            </button>
          </div>
        </Modal>
      )}

      {showShare && (
        <Modal onClose={() => setShowShare(false)} title="Sitzung beitreten">
          <div className="flex flex-col items-center text-center">
            <p className="text-slate-600 mb-2 font-mono font-bold text-lg">{session.room_code}</p>
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 mb-6">
              <QRCodeSVG
                value={joinUrl}
                size={session.presentationMode ? 280 : 200}
                level="H"
                includeMargin
              />
            </div>
            <p className="text-slate-600 mb-4">QR-Code scannen oder Link teilen (ohne PIN):</p>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 w-full flex items-center justify-between mb-6">
              <code className="text-blue-600 font-mono text-sm truncate mr-4">{joinUrl}</code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(joinUrl);
                  alert('Link kopiert!');
                }}
                className="text-slate-400 hover:text-blue-600"
              >
                Kopieren
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showSettings && isTeacher && (
        <Modal onClose={() => setShowSettings(false)} title="Sitzungseinstellungen">
          <div className="space-y-6">
            <section>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Sitzungsstatus</h3>
              <button
                type="button"
                onClick={toggleSessionLock}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                  session.status === 'active'
                    ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                    : 'bg-rose-50 border-rose-100 text-rose-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  {session.status === 'active' ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                  <span className="font-bold">
                    {session.status === 'active' ? 'Sitzung ist offen' : 'Sitzung ist gesperrt'}
                  </span>
                </div>
                <div
                  className={`w-12 h-6 rounded-full relative transition-colors ${
                    session.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${
                      session.status === 'active' ? 'right-1' : 'left-1'
                    }`}
                  />
                </div>
              </button>
            </section>

            <section>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Präsentation</h3>
              <button
                type="button"
                onClick={togglePresentationMode}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all mb-6 ${
                  session.presentationMode
                    ? 'bg-amber-50 border-amber-100 text-amber-800'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Presentation className="w-5 h-5" />
                  <div className="text-left">
                    <span className="font-bold block">Präsentations- / Tafelmodus</span>
                    <span className="text-xs font-normal opacity-80">
                      Größerer QR-Code, Ideen in Spalten, größere Umfrage &amp; Wortwolke
                    </span>
                  </div>
                </div>
                <div
                  className={`w-12 h-6 rounded-full relative transition-colors ${
                    session.presentationMode ? 'bg-amber-500' : 'bg-slate-300'
                  }`}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${
                      session.presentationMode ? 'right-1' : 'left-1'
                    }`}
                  />
                </div>
              </button>
            </section>

            <section>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Nutzung für SuS</h3>
              <p className="text-xs text-slate-500 mb-4">
                Schülerinnen und Schüler sehen auf dem Smartphone nur die Bereiche, die hier eingeschaltet sind –
                weniger Ablenkung, klarere Bedienung.
              </p>
              <div className="grid grid-cols-1 gap-3">
                <PermissionToggle
                  label="Tafel zeichnen"
                  active={session.permissions.drawBoard}
                  onClick={() => togglePermission('drawBoard')}
                />
                <PermissionToggle
                  label="Ideen hinzufügen"
                  active={session.permissions.addSticky}
                  onClick={() => togglePermission('addSticky')}
                />
                <PermissionToggle
                  label="Ideen verschieben"
                  active={session.permissions.moveSticky}
                  onClick={() => togglePermission('moveSticky')}
                />
                <PermissionToggle
                  label="Ideen sortieren (Überschriften, Moderation)"
                  active={session.permissions.organizeBrainstorm}
                  onClick={() => togglePermission('organizeBrainstorm')}
                />
                <PermissionToggle
                  label="Umfragen beantworten"
                  active={session.permissions.answerPoll}
                  onClick={() => togglePermission('answerPoll')}
                />
                <PermissionToggle
                  label="Wörter einsenden"
                  active={session.permissions.submitWord}
                  onClick={() => togglePermission('submitWord')}
                />
              </div>
            </section>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NavIcon({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 group transition-all ${active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
    >
      <div className={`p-3 rounded-2xl transition-all ${active ? 'bg-blue-50 shadow-sm' : 'group-hover:bg-slate-50'}`}>
        {icon}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl p-8 w-full max-w-lg shadow-2xl"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function PermissionToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
        active ? 'bg-blue-50 border-blue-100 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-500'
      }`}
    >
      <span className="font-semibold">{label}</span>
      <div className={`w-10 h-5 rounded-full relative transition-colors ${active ? 'bg-blue-600' : 'bg-slate-300'}`}>
        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${active ? 'right-1' : 'left-1'}`} />
      </div>
    </button>
  );
}
