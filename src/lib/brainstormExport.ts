import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  buildSanitizedExportClone,
  sanitizeClonedSubtree,
  stripDocumentStyles,
  waitForExportImages,
} from './brainstormExportSanitize';

export const BRAINSTORM_EXPORT_ROOT_SELECTOR = '[data-brainstorm-export-root]';

export async function waitForBrainstormExportRoot(options?: { timeoutMs?: number }): Promise<HTMLElement | null> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = document.querySelector(BRAINSTORM_EXPORT_ROOT_SELECTOR) as HTMLElement | null;
    if (el && el.isConnected && el.offsetWidth >= 16 && el.offsetHeight >= 16) {
      return el;
    }
    await new Promise((r) => setTimeout(r, 48));
  }
  return document.querySelector(BRAINSTORM_EXPORT_ROOT_SELECTOR) as HTMLElement | null;
}

function createIsolatedExportFrame(width: number, height: number): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'export');
  iframe.style.cssText = [
    'position:fixed',
    'left:-32000px',
    'top:0',
    `width:${width}px`,
    `height:${height}px`,
    'border:0',
    'opacity:0',
    'pointer-events:none',
    'visibility:hidden',
  ].join(';');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error('Export-iframe konnte nicht erstellt werden.');
  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#fff;overflow:hidden;width:${width}px;height:${height}px;"></body></html>`
  );
  doc.close();
  stripDocumentStyles(doc);
  return iframe;
}

async function captureElement(source: HTMLElement): Promise<HTMLCanvasElement> {
  const w = source.offsetWidth || source.scrollWidth;
  const h = source.offsetHeight || source.scrollHeight;
  if (w < 8 || h < 8) {
    throw new Error('Die Ideenfläche hat noch keine sichtbare Größe.');
  }

  const iframe = createIsolatedExportFrame(w, h);
  const idoc = iframe.contentDocument!;

  const clone = buildSanitizedExportClone(source);
  clone.style.width = `${w}px`;
  clone.style.height = `${h}px`;
  clone.style.minWidth = `${w}px`;
  clone.style.minHeight = `${h}px`;
  idoc.body.appendChild(clone);
  stripDocumentStyles(idoc);

  await waitForExportImages(clone);

  try {
    return await html2canvas(clone, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: w,
      height: h,
      windowWidth: w,
      windowHeight: h,
      foreignObjectRendering: false,
      onclone: (clonedDoc, clonedEl) => {
        stripDocumentStyles(clonedDoc);
        const el = clonedEl as HTMLElement;
        el.style.background = '#ffffff';
        el.style.backgroundColor = '#ffffff';
        sanitizeClonedSubtree(el, clone);
        clonedDoc.querySelectorAll('*').forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          node.style.filter = 'none';
          node.style.backdropFilter = 'none';
        });
      },
    });
  } finally {
    iframe.remove();
  }
}

export async function downloadBrainstormCanvasPng(element: HTMLElement, fileBasename: string): Promise<void> {
  const canvas = await captureElement(element);
  const link = document.createElement('a');
  link.download = `${fileBasename}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
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

export async function downloadBrainstormCanvasPdf(element: HTMLElement, fileBasename: string): Promise<void> {
  const canvas = await captureElement(element);
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ratio = canvas.width / canvas.height;
  let imgWidthMm = pageWidth;
  let imgHeightMm = imgWidthMm / ratio;
  if (imgHeightMm > pageHeight) {
    imgHeightMm = pageHeight;
    imgWidthMm = imgHeightMm * ratio;
  }
  appendImageAcrossPages(pdf, imgData, imgWidthMm, imgHeightMm);
  pdf.save(`${fileBasename}.pdf`);
}
