import jsPDF from 'jspdf';
import { supabase } from './supabase';
import { rowToSticky, rowToPoll, rowToPollResponse, rowToWord } from './dbMap';
import type { Poll, PollResponse, StickyNote, WordEntry } from '../types';

export interface SessionExportBundle {
  stickies: StickyNote[];
  polls: Poll[];
  responsesByPoll: Record<string, PollResponse[]>;
  words: WordEntry[];
}

export async function fetchSessionExportData(sessionId: string): Promise<SessionExportBundle> {
  const { data: st } = await supabase
    .from('stickies')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  const stickies = (st ?? []).map((r) => rowToSticky(r as Record<string, unknown>));

  const { data: pr } = await supabase
    .from('polls')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  const polls = (pr ?? []).map((r) => rowToPoll(r as Record<string, unknown>));

  const { data: respRows } = await supabase.from('poll_responses').select('*').eq('session_id', sessionId);
  const responsesByPoll: Record<string, PollResponse[]> = {};
  for (const p of polls) responsesByPoll[p.id] = [];
  for (const r of respRows ?? []) {
    const row = rowToPollResponse(r as Record<string, unknown>);
    if (!responsesByPoll[row.pollId]) responsesByPoll[row.pollId] = [];
    responsesByPoll[row.pollId].push(row);
  }

  const { data: wr } = await supabase
    .from('words')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  const words = (wr ?? []).map((r) => rowToWord(r as Record<string, unknown>));

  return { stickies, polls, responsesByPoll, words };
}

export function safeExportBasename(name: string): string {
  const t = name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '-').trim();
  return t.slice(0, 80) || 'Sitzung';
}

export function buildProtocolText(
  sessionName: string,
  roomCode: string,
  joinUrl: string,
  bundle: SessionExportBundle
): string {
  const lines: string[] = [];
  const now = new Date().toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  lines.push('TafelFlow – Sitzungsprotokoll');
  lines.push('');
  lines.push(`Sitzung: ${sessionName}`);
  lines.push(`Raumcode: ${roomCode}`);
  lines.push(`Beitritts-Link: ${joinUrl}`);
  lines.push(`Export: ${now}`);
  lines.push('');

  lines.push('=== Ideen & Überschriften ===');
  const heads = bundle.stickies
    .filter((s) => s.stickyType === 'heading')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const notes = bundle.stickies.filter((s) => s.stickyType === 'note');

  if (heads.length === 0 && notes.length === 0) {
    lines.push('(keine Einträge)');
  } else {
    for (const h of heads) {
      lines.push('');
      lines.push(`## ${h.content}`);
      const under = notes.filter((n) => n.underHeadingId === h.id);
      if (under.length === 0) lines.push('  (noch keine Ideen)');
      for (const n of under) {
        const pend = n.status === 'pending' ? ' [Freigabe ausstehend]' : '';
        lines.push(`  • ${n.content} (${n.authorName})${pend}`);
      }
    }
    const orphan = notes.filter((n) => !n.underHeadingId);
    if (orphan.length) {
      lines.push('');
      lines.push('## Ohne Überschrift / Sammeln');
      for (const n of orphan) {
        const pend = n.status === 'pending' ? ' [Freigabe ausstehend]' : '';
        lines.push(`  • ${n.content} (${n.authorName})${pend}`);
      }
    }
  }

  lines.push('');
  lines.push('=== Umfragen ===');
  if (bundle.polls.length === 0) {
    lines.push('(keine Umfragen)');
  } else {
    for (const p of bundle.polls) {
      lines.push('');
      lines.push(`Frage: ${p.question}`);
      lines.push(`Status: ${p.active ? 'aktiv' : 'beendet'}`);
      const resp = bundle.responsesByPoll[p.id] ?? [];
      const total = resp.length;
      const opts = p.options ?? [];
      if (opts.length === 0) {
        lines.push('  (keine festen Antwortoptionen – offene Antworten nicht gruppiert)');
        for (const r of resp) lines.push(`  • ${r.answer}`);
      } else {
        for (const opt of opts) {
          const c = resp.filter((r) => r.answer === opt).length;
          const pct = total ? Math.round((c / total) * 100) : 0;
          lines.push(`  • ${opt}: ${c} Stimme(n) (${pct}%)`);
        }
      }
      lines.push(`  Teilnahmen gesamt: ${total}`);
    }
  }

  lines.push('');
  lines.push('=== Wortwolke (Häufigkeit) ===');
  const counts: Record<string, number> = {};
  for (const w of bundle.words) counts[w.word] = (counts[w.word] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    lines.push('(keine Begriffe)');
  } else {
    for (const [word, c] of sorted) {
      lines.push(`${word}: ${c}x`);
    }
  }

  lines.push('');
  lines.push('— Ende des Protokolls —');
  return lines.join('\n');
}

export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Mehrseitiges PDF aus Protokolltext (UTF-8-Inhalt, Standard-Schrift). */
export function downloadProtocolPdf(sessionName: string, protocolText: string): void {
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const margin = 14;
  const maxW = pdf.internal.pageSize.getWidth() - 2 * margin;
  let y = margin;
  const lh = 5;
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.setFontSize(10);

  const paragraphs = protocolText.split('\n');
  for (const para of paragraphs) {
    if (para.trim() === '') {
      y += lh * 0.4;
      if (y > pageH - margin) {
        pdf.addPage();
        y = margin;
      }
      continue;
    }
    const wrapped = pdf.splitTextToSize(para, maxW);
    for (const line of wrapped) {
      if (y + lh > pageH - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += lh;
    }
  }

  pdf.save(`${safeExportBasename(sessionName)}-Protokoll.pdf`);
}
