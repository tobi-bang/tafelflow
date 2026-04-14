import type { ReactNode } from 'react';
import type { SessionTabId } from './sessionToolMeta';
import type { BoardModule } from '../types';

export interface ModuleRegistryEntry {
  type: string;
  title: string;
  addLabel: string;
  defaultSize: { width: number; height: number };
  defaultData?: Record<string, unknown>;
  openTab?: SessionTabId;
  render: (args: { module: BoardModule; onOpenTool?: (tab: SessionTabId) => void }) => ReactNode;
}

export const moduleRegistry: Record<string, ModuleRegistryEntry> = {
  text: {
    type: 'text',
    title: 'Notizmodul',
    addLabel: 'Textmodul',
    defaultSize: { width: 360, height: 220 },
    defaultData: { text: '' },
    render: ({ module }) => {
      const text = String(module.data.text ?? '');
      return (
        <div className="h-full overflow-auto whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
          {text || 'Leere Notiz'}
        </div>
      );
    },
  },
  brainstorming: {
    type: 'brainstorming',
    title: 'Ideensammeln',
    addLabel: 'Ideen',
    defaultSize: { width: 420, height: 280 },
    openTab: 'brainstorming',
    render: ({ onOpenTool }) => renderToolPlaceholder('Ideensammeln', 'brainstorming', onOpenTool),
  },
  wordcloud: {
    type: 'wordcloud',
    title: 'Wortwolke',
    addLabel: 'Wortwolke',
    defaultSize: { width: 420, height: 280 },
    openTab: 'wordcloud',
    render: ({ onOpenTool }) => renderToolPlaceholder('Wortwolke', 'wordcloud', onOpenTool),
  },
  livepoll: {
    type: 'livepoll',
    title: 'Live-Abstimmung',
    addLabel: 'Live-Poll',
    defaultSize: { width: 420, height: 280 },
    openTab: 'livepoll',
    render: ({ onOpenTool }) => renderToolPlaceholder('Live-Abstimmung', 'livepoll', onOpenTool),
  },
  peerfeedback: {
    type: 'peerfeedback',
    title: 'Peer-Feedback',
    addLabel: 'Peer',
    defaultSize: { width: 420, height: 280 },
    openTab: 'peerfeedback',
    render: ({ onOpenTool }) => renderToolPlaceholder('Peer-Feedback', 'peerfeedback', onOpenTool),
  },
};

export const moduleRegistryList = Object.values(moduleRegistry);

function renderToolPlaceholder(title: string, tab: SessionTabId, onOpenTool?: (tab: SessionTabId) => void) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-3 text-slate-600">
      <p className="font-bold text-slate-800">{title}</p>
      <p className="text-xs text-slate-500 max-w-[18rem]">Dieses Modul ist auf der gemeinsamen Tafel verankert.</p>
      <button
        type="button"
        onClick={() => onOpenTool?.(tab)}
        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
      >
        Tool öffnen
      </button>
    </div>
  );
}
