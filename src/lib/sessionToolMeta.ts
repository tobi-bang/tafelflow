/**
 * Einheitliche Texte und Kurzbeschreibungen für Sitzungs-Tools (Navigation + Kopfbereich).
 */
export type SessionTabId =
  | 'board'
  | 'brainstorming'
  | 'polls'
  | 'wordcloud'
  | 'livepoll'
  | 'peerfeedback'
  | 'pictureload'
  | 'buzzer';

export const SESSION_TAB_ORDER: SessionTabId[] = [
  'board',
  'brainstorming',
  'buzzer',
  'polls',
  'wordcloud',
  'livepoll',
  'peerfeedback',
  'pictureload',
];

export type SessionToolMeta = {
  /** Kurzes Label in der Seitenleiste */
  navLabel: string;
  title: string;
  descriptionTeacher: string;
  descriptionStudent: string;
};

export const SESSION_TOOL_META: Record<SessionTabId, SessionToolMeta> = {
  board: {
    navLabel: 'Tafel',
    title: 'Gemeinsame Tafel',
    descriptionTeacher: 'Zeichnen, erklären, visualisieren – für alle sichtbar.',
    descriptionStudent: 'Siehst du die Tafel der Lehrkraft und kannst ggf. mitzeichnen.',
  },
  brainstorming: {
    navLabel: 'Ideen',
    title: 'Ideen sammeln',
    descriptionTeacher: 'Karten anlegen, freigeben und zu Überschriften ordnen.',
    descriptionStudent: 'Schreibe Ideen auf Karten und ordne sie ggf. ein.',
  },
  buzzer: {
    navLabel: 'Buzzer',
    title: 'Buzzer',
    descriptionTeacher: 'Ersten Buzz live sehen, Warteschlange steuern und Runden zurücksetzen.',
    descriptionStudent: 'Drücke den Buzzer, sobald du dran sein möchtest.',
  },
  polls: {
    navLabel: 'Umfrage',
    title: 'Umfragen',
    descriptionTeacher: 'Fragen anlegen, Optionen ergänzen und Ergebnisse live sehen.',
    descriptionStudent: 'Wähle eine Antwort – deine Stimme zählt einmal.',
  },
  wordcloud: {
    navLabel: 'Wolke',
    title: 'Wortwolke',
    descriptionTeacher: 'Begriffe einsammeln; Häufigkeit bestimmt die Größe.',
    descriptionStudent: 'Schick ein Wort oder einen kurzen Begriff mit.',
  },
  livepoll: {
    navLabel: 'Live',
    title: 'Live-Abstimmung',
    descriptionTeacher: 'Schnelle Abstimmung mit optionaler Begründung (nur dieses Gerät/Tab synchron).',
    descriptionStudent: 'Tippe deine Wahl – Ergebnisse siehst du direkt.',
  },
  peerfeedback: {
    navLabel: 'Feedback',
    title: 'Peer-Feedback',
    descriptionTeacher: 'Kriterien festlegen und Rückmeldungen der Gruppe auswerten.',
    descriptionStudent: 'Bewerte die Kriterien und optional mit einem kurzen Kommentar.',
  },
  pictureload: {
    navLabel: 'Pictures',
    title: 'Pictureload',
    descriptionTeacher: 'Bilderwand der SuS verwalten – Uploads prüfen und bei Bedarf löschen.',
    descriptionStudent: 'Lade Fotos hoch und sieh die gemeinsame Bilderwand der Klasse.',
  },
};
