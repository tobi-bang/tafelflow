import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  BarChart3,
  ChevronLeft,
  Cloud,
  Download,
  FileText,
  ImageDown,
  LayoutGrid,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  PanelLeft,
  Presentation,
  Settings,
  Share2,
  Smartphone,
  Unlock,
  UsersRound,
  Vote,
  X,
  Power,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { rowToSession } from '../lib/dbMap';
import type { Session, SessionPermissions } from '../types';
import Board from '../components/Board';
import Brainstorming from '../components/Brainstorming';
import Polls from '../components/Polls';
import WordCloud from '../components/WordCloud';
import LivePoll from '../components/LivePoll';
import PeerFeedback from '../components/PeerFeedback';
import SessionToolShell from '../components/session/SessionToolShell';
import type { SessionTabId } from '../lib/sessionToolMeta';
import { SESSION_TAB_ORDER, SESSION_TOOL_META } from '../lib/sessionToolMeta';
import {
  getEffectiveSessionRole,
  isEffectiveTeacher,
  readPreviewAsStudentPreference,
  writePreviewAsStudentPreference,
} from '../lib/sessionRole';
import {
  buildProtocolText,
  downloadProtocolPdf,
  downloadTextFile,
  fetchSessionExportData,
  safeExportBasename,
} from '../lib/sessionExport';
import { createBoardModule, tabToModuleType } from '../lib/boardModules';

type Tab = SessionTabId;

const ALL_TABS: Tab[] = [...SESSION_TAB_ORDER];

/** Sidebar links: Standard aus (max. Platz). Auf „1“ setzen, um die Leiste wieder zu öffnen (nur Lehrkraft-UI). */
const LEGACY_TOOL_RAIL_STORAGE_KEY = 'tafelflow_legacy_tool_rail';

function readLegacyToolRailPreference(): boolean {
  try {
    return sessionStorage.getItem(LEGACY_TOOL_RAIL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLegacyToolRailPreference(open: boolean) {
  try {
    sessionStorage.setItem(LEGACY_TOOL_RAIL_STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function visibleTabsForStudent(p: SessionPermissions): Tab[] {
  const tabs: Tab[] = [];
  if (p.drawBoard) tabs.push('board');
  if (p.addSticky || p.moveSticky || p.organizeBrainstorm) tabs.push('brainstorming');
  if (p.answerPoll) tabs.push('polls');
  if (p.submitWord) tabs.push('wordcloud');
  if (p.livePoll) tabs.push('livepoll');
  if (p.peerFeedback) tabs.push('peerfeedback');
  return tabs;
}

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  board: <Presentation className="w-6 h-6" />,
  brainstorming: <FileText className="w-6 h-6" />,
  polls: <BarChart3 className="w-6 h-6" />,
  wordcloud: <Cloud className="w-6 h-6" />,
  livepoll: <Vote className="w-6 h-6" />,
  peerfeedback: <UsersRound className="w-6 h-6" />,
};

export default function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [isTeacher, setIsTeacher] = useState(false);
  /** Nur für Lehrkräfte: SuS-Oberfläche zur Vorschau (lokal, kein Backend) */
  const [previewAsStudent, setPreviewAsStudent] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('board');
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showToolPicker, setShowToolPicker] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [boardSelectModuleId, setBoardSelectModuleId] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<'pdf' | 'txt' | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** Option B: klassische linke Icon-Leiste (Standard: ausgeblendet) */
  const [legacyToolRailOpen, setLegacyToolRailOpen] = useState(readLegacyToolRailPreference);

  const navigate = useNavigate();
  const mainRef = useRef<HTMLDivElement>(null);

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
    if (isTeacher) setPreviewAsStudent(readPreviewAsStudentPreference());
    else setPreviewAsStudent(false);
  }, [isTeacher]);

  const effectiveIsTeacher = isEffectiveTeacher(isTeacher, previewAsStudent);
  const sessionRole = getEffectiveSessionRole(isTeacher, previewAsStudent);

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
    void load();

    const channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, navigate]);

  const participantTabs = useMemo(() => {
    if (!session) return ALL_TABS;
    if (effectiveIsTeacher) return ALL_TABS;
    return visibleTabsForStudent(session.permissions);
  }, [session, effectiveIsTeacher]);

  const canShowLegacyToolRail = Boolean(session && (effectiveIsTeacher || participantTabs.length > 1));
  const showLegacyToolRail = legacyToolRailOpen && canShowLegacyToolRail;
  /** Lehrkraft braucht immer den Tools-Zugang (auch SuS-Vorschau mit nur einem freigeschalteten Tool). */
  const showToolsInHeader = isTeacher || participantTabs.length > 1;

  useEffect(() => {
    if (!session || effectiveIsTeacher) return;
    const tabs = visibleTabsForStudent(session.permissions);
    if (tabs.length === 0) return;
    if (!tabs.includes(activeTab)) setActiveTab(tabs[0]);
  }, [session, effectiveIsTeacher, activeTab]);

  if (!session) return null;

  const joinUrl = `${window.location.origin}/join?session=${encodeURIComponent(
    session.id
  )}&room=${encodeURIComponent(session.room_code)}&role=student`;

  type BooleanSessionPermission = Exclude<keyof Session['permissions'], 'ideasDefaultScale'>;

  const togglePermission = async (permission: BooleanSessionPermission) => {
    if (!session || !isTeacher) return;
    const newPermissions = { ...session.permissions, [permission]: !session.permissions[permission] };
    const { error } = await supabase.from('sessions').update({ permissions: newPermissions }).eq('id', session.id);
    if (error) console.error(error);
  };

  const updateIdeasDefaultScale = async (value: number) => {
    if (!session || !isTeacher) return;
    const clamped = Math.min(4, Math.max(0.5, value));
    const newPermissions = { ...session.permissions, ideasDefaultScale: clamped };
    const { error } = await supabase.from('sessions').update({ permissions: newPermissions }).eq('id', session.id);
    if (error) console.error(error);
  };

  const togglePresentationMode = async () => {
    if (!session || !isTeacher) return;
    const next = !session.presentationMode;
    const { error } = await supabase.from('sessions').update({ presentation_mode: next }).eq('id', session.id);
    if (error) console.error(error);
  };

  const toggleBrowserFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSessionLock = async () => {
    if (!session || !isTeacher) return;
    const newStatus = session.status === 'active' ? 'locked' : 'active';
    const { error } = await supabase.from('sessions').update({ status: newStatus }).eq('id', session.id);
    if (error) console.error(error);
  };

  const toggleSessionEnd = async () => {
    if (!session || !isTeacher) return;
    const isEnded = session.status === 'archived';
    const nextStatus = isEnded ? 'active' : 'archived';
    const ok = isEnded ? true : confirm('Sitzung wirklich beenden? SuS können danach nicht mehr beitreten oder weiterarbeiten.');
    if (!ok) return;
    const { error } = await supabase.from('sessions').update({ status: nextStatus }).eq('id', session.id);
    if (error) console.error(error);
  };

  const handleExportBoardSnapshot = async () => {
    if (!mainRef.current || isExporting || !session) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(mainRef.current, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${safeExportBasename(session.name)}-Tafel.pdf`);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportProtocolPdf = async () => {
    if (!sessionId || !session || exportBusy) return;
    setExportBusy('pdf');
    try {
      const bundle = await fetchSessionExportData(sessionId);
      const text = buildProtocolText(session.name, session.room_code, joinUrl, bundle);
      downloadProtocolPdf(session.name, text);
    } catch (e) {
      console.error(e);
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportProtocolTxt = async () => {
    if (!sessionId || !session || exportBusy) return;
    setExportBusy('txt');
    try {
      const bundle = await fetchSessionExportData(sessionId);
      const text = buildProtocolText(session.name, session.room_code, joinUrl, bundle);
      downloadTextFile(text, `${safeExportBasename(session.name)}-Protokoll.txt`);
    } catch (e) {
      console.error(e);
    } finally {
      setExportBusy(null);
    }
  };

  const studentBlocked = (!isTeacher || previewAsStudent) && session.status !== 'active';

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate(isTeacher && !previewAsStudent ? '/teacher' : '/')}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Zurück"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          {isTeacher && !previewAsStudent && canShowLegacyToolRail && (
            <button
              type="button"
              onClick={() => {
                const next = !legacyToolRailOpen;
                setLegacyToolRailOpen(next);
                writeLegacyToolRailPreference(next);
              }}
              className={`p-2 rounded-lg transition-colors shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center border ${
                legacyToolRailOpen
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'border-transparent hover:bg-slate-100 text-slate-500'
              }`}
              title={legacyToolRailOpen ? 'Linke Werkzeugleiste ausblenden' : 'Linke Werkzeugleiste einblenden'}
              aria-label={legacyToolRailOpen ? 'Linke Werkzeugleiste ausblenden' : 'Linke Werkzeugleiste einblenden'}
              aria-pressed={legacyToolRailOpen}
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex flex-col min-w-0">
            <h1 className="text-lg font-bold text-slate-900 leading-none truncate">{session.name}</h1>
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wider mt-1">
              {effectiveIsTeacher
                ? `Lehrkraft · Raumcode ${session.room_code}`
                : isTeacher && previewAsStudent
                  ? 'Vorschau Schüleransicht'
                  : 'Schüleransicht'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {showToolsInHeader && (
            <button
              type="button"
              onClick={() => setShowToolPicker(true)}
              className="flex items-center gap-2 px-3 py-2.5 border border-slate-200 bg-white text-slate-800 rounded-xl font-semibold hover:bg-slate-50 transition-colors min-h-[44px]"
              title="Tool wählen"
            >
              <LayoutGrid className="w-5 h-5 shrink-0" />
              <span className="hidden sm:inline text-sm">Tools</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowShare(true)}
            className="flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-blue-50 text-blue-600 rounded-xl font-semibold hover:bg-blue-100 transition-colors min-h-[44px]"
          >
            <Share2 className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">QR</span>
          </button>

          {isTeacher && (
            <button
              type="button"
              onClick={() => {
                const next = !previewAsStudent;
                setPreviewAsStudent(next);
                writePreviewAsStudentPreference(next);
              }}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm transition-colors min-h-[44px] ${
                previewAsStudent ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              title={previewAsStudent ? 'Zur Lehrkraft-Ansicht' : 'Schüleransicht (Vorschau)'}
            >
              <Smartphone className="w-5 h-5 shrink-0" />
              <span className="hidden xl:inline">{previewAsStudent ? 'Lehrkraft' : 'Als SuS'}</span>
            </button>
          )}

          {isTeacher && (
            <>
              <button
                type="button"
                onClick={toggleSessionEnd}
                className={`hidden md:flex items-center gap-2 px-3 py-2 rounded-xl font-semibold transition-colors ${
                  session.status === 'archived'
                    ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
                title={session.status === 'archived' ? 'Sitzung aktivieren' : 'Sitzung beenden'}
              >
                <Power className="w-4 h-4" />
                <span className="text-sm">{session.status === 'archived' ? 'Aktivieren' : 'Beenden'}</span>
              </button>
              <button
                type="button"
                onClick={togglePresentationMode}
                className={`hidden md:flex items-center gap-2 px-3 py-2 rounded-xl font-semibold transition-colors ${
                  session.presentationMode
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title="Präsentationsmodus"
              >
                <Presentation className="w-4 h-4" />
                <span className="text-sm">Tafel</span>
              </button>
              <button
                type="button"
                onClick={toggleBrowserFullscreen}
                className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-600"
                title="Vollbild"
              >
                {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={() => setShowExportModal(true)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-700 font-semibold text-sm"
                title="Ergebnisse speichern"
              >
                <Download className="w-5 h-5" />
                <span className="hidden lg:inline">Speichern</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-600"
                title="Einstellungen"
              >
                <Settings className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </header>

      {isTeacher && previewAsStudent && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-center text-sm text-amber-950 shrink-0 z-10">
          <span className="font-semibold">Vorschau: Schüleransicht</span>
          <span className="hidden sm:inline"> — Verwaltung (Beenden, Einstellungen, QR) bleibt oben sichtbar.</span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden min-h-0 w-full min-w-0">
        {showLegacyToolRail && (
          <nav
            className="w-[4.5rem] sm:w-[5.25rem] bg-white border-r border-slate-200 flex flex-col items-stretch py-3 sm:py-5 gap-2 sm:gap-3 shrink-0 overflow-y-auto overflow-x-hidden touch-pan-y"
            aria-label="Werkzeuge der Sitzung (klassische Leiste)"
          >
            {(effectiveIsTeacher ? ALL_TABS : participantTabs).map((tab) => (
              <React.Fragment key={tab}>
                <NavIcon
                  active={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  icon={TAB_ICONS[tab]}
                  label={SESSION_TOOL_META[tab].navLabel}
                  title={SESSION_TOOL_META[tab].title}
                />
              </React.Fragment>
            ))}
          </nav>
        )}

        <main className="flex-1 relative overflow-hidden bg-slate-100 min-w-0 w-full" ref={mainRef}>
          {studentBlocked && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-700 z-10 bg-slate-50">
              <p className="font-bold text-slate-900 text-xl">Sitzung ist beendet oder gesperrt</p>
              <p className="text-sm mt-3 max-w-sm text-slate-600">
                Die Lehrkraft hat die Sitzung geschlossen. Du kannst nicht weiter bearbeiten.
              </p>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="mt-6 px-5 py-3 rounded-2xl bg-white border border-slate-200 font-semibold hover:bg-slate-50"
              >
                Zur Startseite
              </button>
            </div>
          )}

          {!effectiveIsTeacher && !studentBlocked && participantTabs.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-600 z-10 bg-slate-50">
              <p className="font-semibold text-slate-800 text-lg">Für dich ist gerade nichts freigeschaltet</p>
              <p className="text-sm mt-3 max-w-sm">
                Die Lehrkraft kann unter Sitzungseinstellungen bei <strong>Nutzung für SuS</strong> Tafel, Ideen, Umfrage, Wortwolke, Live-Abstimmung oder Peer-Feedback aktivieren.
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
                className="absolute inset-0 w-full h-full flex flex-col min-h-0"
              >
                <SessionToolShell
                  tabId="board"
                  role={sessionRole}
                  presentationMode={session.presentationMode}
                  variant="canvas"
                >
                  <div className="flex-1 min-h-0 min-w-0 bg-white">
                    <Board
                      sessionId={session.id}
                      isTeacher={effectiveIsTeacher}
                      permissions={session.permissions}
                      presentationMode={session.presentationMode}
                      onOpenTool={(tab) => setActiveTab(tab)}
                      selectModuleId={boardSelectModuleId}
                      onHandledSelectModuleId={() => setBoardSelectModuleId(null)}
                    />
                  </div>
                </SessionToolShell>
              </motion.div>
            )}
            {activeTab === 'brainstorming' && participantTabs.includes('brainstorming') && (
              <motion.div
                key="brainstorming"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 w-full h-full flex flex-col min-h-0"
              >
                <SessionToolShell
                  tabId="brainstorming"
                  role={sessionRole}
                  presentationMode={session.presentationMode}
                  variant="canvas"
                >
                  <div className="flex-1 min-h-0">
                    <Brainstorming
                      sessionId={session.id}
                      isTeacher={effectiveIsTeacher}
                      permissions={session.permissions}
                      presentationMode={session.presentationMode}
                    />
                  </div>
                </SessionToolShell>
              </motion.div>
            )}
            {activeTab === 'polls' && participantTabs.includes('polls') && (
              <motion.div
                key="polls"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 w-full h-full flex flex-col min-h-0"
              >
                <SessionToolShell tabId="polls" role={sessionRole} presentationMode={session.presentationMode} variant="page">
                  <Polls
                    sessionId={session.id}
                    isTeacher={effectiveIsTeacher}
                    permissions={session.permissions}
                    presentationMode={session.presentationMode}
                  />
                </SessionToolShell>
              </motion.div>
            )}
            {activeTab === 'wordcloud' && participantTabs.includes('wordcloud') && (
              <motion.div
                key="wordcloud"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 w-full h-full flex flex-col min-h-0"
              >
                <SessionToolShell tabId="wordcloud" role={sessionRole} presentationMode={session.presentationMode} variant="page">
                  <WordCloud
                    sessionId={session.id}
                    isTeacher={effectiveIsTeacher}
                    permissions={session.permissions}
                    presentationMode={session.presentationMode}
                  />
                </SessionToolShell>
              </motion.div>
            )}
            {activeTab === 'livepoll' && participantTabs.includes('livepoll') && (
              <motion.div
                key="livepoll"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 w-full h-full flex flex-col min-h-0"
              >
                <SessionToolShell tabId="livepoll" role={sessionRole} presentationMode={session.presentationMode} variant="page">
                  <LivePoll sessionId={session.id} isTeacher={effectiveIsTeacher} presentationMode={session.presentationMode} />
                </SessionToolShell>
              </motion.div>
            )}
            {activeTab === 'peerfeedback' && participantTabs.includes('peerfeedback') && (
              <motion.div
                key="peerfeedback"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 w-full h-full flex flex-col min-h-0"
              >
                <SessionToolShell
                  tabId="peerfeedback"
                  role={sessionRole}
                  presentationMode={session.presentationMode}
                  variant="page"
                >
                  <PeerFeedback sessionId={session.id} isTeacher={effectiveIsTeacher} presentationMode={session.presentationMode} />
                </SessionToolShell>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {showToolPicker && session && (
        <Modal onClose={() => setShowToolPicker(false)} title="Tool wählen">
          <p className="text-slate-600 text-sm mb-4">Tippe ein Werkzeug – ideal für Smartphones und Tablets.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[min(70vh,520px)] overflow-y-auto pr-1">
            {participantTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={async () => {
                  const moduleType = tabToModuleType(tab);
                  if (effectiveIsTeacher && moduleType && session) {
                    try {
                      const id = await createBoardModule(session.id, moduleType);
                      setBoardSelectModuleId(id);
                      setActiveTab('board');
                    } catch (err) {
                      console.error(err);
                      alert(err instanceof Error ? err.message : 'Tool-Modul konnte nicht erstellt werden.');
                    }
                  } else {
                    setActiveTab(tab);
                  }
                  setShowToolPicker(false);
                }}
                className={`flex gap-3 p-4 rounded-2xl border text-left transition-all min-h-[72px] ${
                  activeTab === tab ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-200 hover:bg-slate-50'
                }`}
              >
                <div className="shrink-0 text-blue-600 [&>svg]:w-8 [&>svg]:h-8">{TAB_ICONS[tab]}</div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-900">{SESSION_TOOL_META[tab].title}</div>
                  <div className="text-xs text-slate-600 mt-1 leading-snug">
                    {effectiveIsTeacher ? SESSION_TOOL_META[tab].descriptionTeacher : SESSION_TOOL_META[tab].descriptionStudent}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {showShare && (
        <Modal onClose={() => setShowShare(false)} title="Schüler beitreten">
          <div className="flex flex-col items-center text-center">
            <p className="text-slate-600 mb-2 font-mono font-bold text-lg">{session.room_code}</p>
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 mb-6">
              <QRCodeSVG value={joinUrl} size={session.presentationMode ? 280 : 220} level="H" includeMargin />
            </div>
            <p className="text-slate-600 mb-4">QR-Code scannen oder Link teilen:</p>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 w-full flex items-center justify-between mb-2">
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

      {showExportModal && isTeacher && (
        <Modal onClose={() => setShowExportModal(false)} title="Ergebnisse festhalten">
          <p className="text-slate-600 text-sm mb-6">
            Protokoll enthält Ideen (mit Überschriften), Umfrage-Auszählung und Wortwolke. Dateien landen im Download-Ordner.
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
                <div className="text-xs text-slate-500">Einfach weiterleiten</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => void handleExportBoardSnapshot()}
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
                  {activeTab === 'board' ? 'Zeichnungen der Tafel' : 'Bitte zuerst das Tool „Gemeinsame Tafel“ öffnen (Tools-Menü)'}
                </div>
              </div>
            </button>
          </div>
        </Modal>
      )}

      {showSettings && isTeacher && (
        <Modal onClose={() => setShowSettings(false)} title="Sitzungseinstellungen">
          <div className="space-y-6">
            <section>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Sitzungsstatus</h3>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={toggleSessionLock}
                  className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                    session.status === 'active'
                      ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                      : session.status === 'locked'
                        ? 'bg-amber-50 border-amber-100 text-amber-800'
                        : 'bg-slate-100 border-slate-200 text-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {session.status === 'active' ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                    <span className="font-bold">
                      {session.status === 'active' ? 'Sitzung ist offen' : session.status === 'locked' ? 'Sitzung ist gesperrt' : 'Sitzung ist beendet'}
                    </span>
                  </div>
                  <div className={`w-12 h-6 rounded-full relative transition-colors ${session.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${session.status === 'active' ? 'right-1' : 'left-1'}`} />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={toggleSessionEnd}
                  className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                    session.status === 'archived'
                      ? 'bg-slate-200 border-slate-300 text-slate-700'
                      : 'bg-rose-50 border-rose-100 text-rose-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Power className="w-5 h-5" />
                    <span className="font-bold">{session.status === 'archived' ? 'Sitzung aktivieren' : 'Sitzung beenden'}</span>
                  </div>
                  <span className="text-xs opacity-80">{session.status === 'archived' ? 'SuS können wieder beitreten' : 'SuS werden ausgesperrt'}</span>
                </button>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Präsentation</h3>
              <button
                type="button"
                onClick={togglePresentationMode}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                  session.presentationMode
                    ? 'bg-amber-50 border-amber-100 text-amber-800'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Presentation className="w-5 h-5" />
                  <div className="text-left">
                    <span className="font-bold block">Präsentations- / Tafelmodus</span>
                    <span className="text-xs font-normal opacity-80">Größerer QR-Code, optimierte Ansicht</span>
                  </div>
                </div>
                <div className={`w-12 h-6 rounded-full relative transition-colors ${session.presentationMode ? 'bg-amber-500' : 'bg-slate-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${session.presentationMode ? 'right-1' : 'left-1'}`} />
                </div>
              </button>
            </section>

            <section>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Nutzung für SuS</h3>
              <p className="text-xs text-slate-500 mb-4">
                SuS sehen auf dem Smartphone nur die Bereiche, die hier eingeschaltet sind.
              </p>
              <div className="grid grid-cols-1 gap-3">
                <PermissionToggle label="Tafel zeichnen" active={session.permissions.drawBoard} onClick={() => togglePermission('drawBoard')} />
                <PermissionToggle label="Ideen hinzufügen" active={session.permissions.addSticky} onClick={() => togglePermission('addSticky')} />
                <PermissionToggle label="Ideen verschieben" active={session.permissions.moveSticky} onClick={() => togglePermission('moveSticky')} />
                <PermissionToggle label="Ideen sortieren (Moderation)" active={session.permissions.organizeBrainstorm} onClick={() => togglePermission('organizeBrainstorm')} />
                <PermissionToggle
                  label="Anzeigename bei Ideen verlangen (SuS)"
                  active={session.permissions.ideasRequireDisplayName}
                  onClick={() => togglePermission('ideasRequireDisplayName')}
                />
                <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 text-left">
                  <label htmlFor="ideas-default-scale" className="font-semibold text-slate-800 block mb-2">
                    Standardgröße neuer Ideen (Board)
                  </label>
                  <p className="text-xs text-slate-500 mb-3">
                    Gilt für neu erstellte Karten. Einzelne Karten können am Board weiter vergrößert oder verkleinert werden.
                  </p>
                  <input
                    id="ideas-default-scale"
                    type="range"
                    min={0.75}
                    max={2.5}
                    step={0.05}
                    value={session.permissions.ideasDefaultScale}
                    onChange={(e) => void updateIdeasDefaultScale(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                  <div className="text-sm text-slate-600 mt-2 tabular-nums">
                    {Math.round(session.permissions.ideasDefaultScale * 100)} % relativ zur Basisgröße
                  </div>
                </div>
                <PermissionToggle label="Umfragen beantworten" active={session.permissions.answerPoll} onClick={() => togglePermission('answerPoll')} />
                <PermissionToggle label="Wörter einsenden" active={session.permissions.submitWord} onClick={() => togglePermission('submitWord')} />
                <PermissionToggle label="Live-Abstimmung" active={session.permissions.livePoll} onClick={() => togglePermission('livePoll')} />
                <PermissionToggle label="Peer-Feedback" active={session.permissions.peerFeedback} onClick={() => togglePermission('peerFeedback')} />
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
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** Vollständiger Tool-Name für Tooltip / Screenreader */
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-current={active ? 'true' : undefined}
      className={`flex flex-col items-center gap-1 group transition-all px-1 py-1 rounded-xl min-h-[4.5rem] justify-center ${
        active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
      }`}
    >
      <div className={`p-2.5 sm:p-3 rounded-2xl transition-all ${active ? 'bg-blue-50 shadow-sm' : 'group-hover:bg-slate-50'}`}>{icon}</div>
      <span className="text-[10px] font-bold uppercase tracking-wider text-center leading-tight px-0.5">{label}</span>
    </button>
  );
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-8 w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full" aria-label="Schließen">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function PermissionToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

