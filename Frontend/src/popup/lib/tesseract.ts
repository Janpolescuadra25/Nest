import Tesseract from 'tesseract.js';

const TESSERACT_DIR = chrome.runtime.getURL('tesseract');

let worker: Tesseract.Worker | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!worker) {
    worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
      workerBlobURL: false,
      workerPath: `${TESSERACT_DIR}/worker.min.js`,
      corePath: `${TESSERACT_DIR}`,
      langPath: `${TESSERACT_DIR}/lang`,
      gzip: true,
      logger: () => {},
    });
  }
  return worker;
}

export async function extractTextFromImage(file: File): Promise<string> {
  const w = await getWorker();
  const result = await w.recognize(file);
  const text = result.data.text.trim();
  if (!text) throw new Error('No text could be extracted from the image.');
  return text;
}

export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    const w = await getWorker();
    const result = await w.recognize(file);
    const text = result.data.text.trim();
    if (text) return text;
  } catch {
    // Fall through to pdfjs-dist approach
  }

  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvas, viewport }).promise;
      const result = await getWorker().then((w) => w.recognize(canvas));
      fullText += result.data.text + '\n';
    }

    const trimmed = fullText.trim();
    if (!trimmed) throw new Error('No text could be extracted from the PDF.');
    return trimmed;
  } catch (err) {
    throw new Error('Failed to process PDF. Please try uploading an image instead.');
  }
}

export function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
