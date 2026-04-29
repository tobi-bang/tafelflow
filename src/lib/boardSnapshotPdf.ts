import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/** Marker am sichtbaren Tafel-Canvas (ohne schwebende Werkzeugleisten) – siehe `Board.tsx`. */
export const BOARD_EXPORT_ROOT_SELECTOR = '[data-board-export-root]';

export class BoardPdfExportError extends Error {
  constructor(
    message: string,
    readonly code: 'AREA_MISSING' | 'AREA_TOO_SMALL' | 'CANVAS_EMPTY' | 'CAPTURE_FAILED'
  ) {
    super(message);
    this.name = 'BoardPdfExportError';
  }
}

/** Wartet, bis die Tafel gemountet ist und eine messbare Größe hat (z. B. nach Tab-Wechsel). */
export async function waitForBoardExportRoot(options?: { timeoutMs?: number }): Promise<HTMLElement | null> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = document.querySelector(BOARD_EXPORT_ROOT_SELECTOR) as HTMLElement | null;
    if (el && el.isConnected && el.clientWidth >= 16 && el.clientHeight >= 16) {
      return el;
    }
    await new Promise((r) => setTimeout(r, 48));
  }
  return document.querySelector(BOARD_EXPORT_ROOT_SELECTOR) as HTMLElement | null;
}

function appendImageAcrossPages(pdf: InstanceType<typeof jsPDF>, imgData: string, imgWidthMm: number, imgHeightMm: number) {
  const pageHeight = pdf.internal.pageSize.getHeight();
  let heightLeft = imgHeightMm;
  let position = 0;
  pdf.addImage(imgData, 'PNG', 0, position, imgWidthMm, imgHeightMm);
  heightLeft -= pageHeight;
  while (heightLeft > 0) {
    position = heightLeft - imgHeightMm;
    pdf.addPage('a4', 'l');
    pdf.addImage(imgData, 'PNG', 0, position, imgWidthMm, imgHeightMm);
    heightLeft -= pageHeight;
  }
}

/**
 * Rendert den übergebenen DOM-Ausschnitt (Tafel-Viewport) per html2canvas und speichert ein A4-quer-PDF.
 */
export async function downloadBoardViewportAsPdf(element: HTMLElement, fileBasename: string): Promise<void> {
  const w = element.clientWidth;
  const h = element.clientHeight;
  if (w < 8 || h < 8) {
    throw new BoardPdfExportError('Die Tafel hat noch keine sichtbare Größe.', 'AREA_TOO_SMALL');
  }

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollX: 0,
      scrollY: 0,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new BoardPdfExportError(`Screenshot fehlgeschlagen: ${reason}`, 'CAPTURE_FAILED');
  }

  if (!canvas || canvas.width < 4 || canvas.height < 4) {
    throw new BoardPdfExportError('Der Screenshot ist leer oder zu klein.', 'CANVAS_EMPTY');
  }

  let imgData: string;
  try {
    imgData = canvas.toDataURL('image/png');
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new BoardPdfExportError(
      `Bild konnte nicht erzeugt werden (z. B. eingebettete fremde Bilder ohne CORS): ${reason}`,
      'CAPTURE_FAILED'
    );
  }

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const imgWidthMm = pageWidth;
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;
  appendImageAcrossPages(pdf, imgData, imgWidthMm, imgHeightMm);

  const safe = fileBasename.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Tafel';
  pdf.save(`${safe}.pdf`);
}
