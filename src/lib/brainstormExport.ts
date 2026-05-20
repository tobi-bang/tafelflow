import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export const BRAINSTORM_EXPORT_ROOT_SELECTOR = '[data-brainstorm-export-root]';

export async function waitForBrainstormExportRoot(options?: { timeoutMs?: number }): Promise<HTMLElement | null> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = document.querySelector(BRAINSTORM_EXPORT_ROOT_SELECTOR) as HTMLElement | null;
    if (el && el.isConnected && el.clientWidth >= 16 && el.clientHeight >= 16) {
      return el;
    }
    await new Promise((r) => setTimeout(r, 48));
  }
  return document.querySelector(BRAINSTORM_EXPORT_ROOT_SELECTOR) as HTMLElement | null;
}

async function captureElement(element: HTMLElement): Promise<HTMLCanvasElement> {
  const w = element.offsetWidth;
  const h = element.offsetHeight;
  if (w < 8 || h < 8) {
    throw new Error('Die Ideenfläche hat noch keine sichtbare Größe.');
  }
  return html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#f1f5f9',
    logging: false,
    width: w,
    height: h,
    windowWidth: w,
    windowHeight: h,
  });
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
