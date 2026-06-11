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

export interface OcrResult {
  text: string;
  confidence: number;
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for OCR preprocessing'));
    img.src = source;
  });
}

async function createCanvasFromSource(source: string | HTMLCanvasElement | HTMLImageElement): Promise<HTMLCanvasElement> {
  if (source instanceof HTMLCanvasElement) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(source, 0, 0);
    return canvas;
  }

  const image = source instanceof HTMLImageElement ? source : await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function preprocessImage(imageSource: string | HTMLCanvasElement | HTMLImageElement): Promise<HTMLCanvasElement> {
  let canvas = await createCanvasFromSource(imageSource);
  let ctx = canvas.getContext('2d')!;
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const grayValues = new Uint8ClampedArray(canvas.width * canvas.height);
  let minGray = 255;
  let maxGray = 0;
  let index = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    pixels[i] = pixels[i + 1] = pixels[i + 2] = gray;
    pixels[i + 3] = 255;
    grayValues[index++] = gray;
    minGray = Math.min(minGray, gray);
    maxGray = Math.max(maxGray, gray);
  }

  ctx.putImageData(imageData, 0, 0);

  const longestSide = Math.max(canvas.width, canvas.height);
  if (longestSide > 2000) {
    const scale = 2000 / longestSide;
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = Math.round(canvas.width * scale);
    scaledCanvas.height = Math.round(canvas.height * scale);
    const scaledCtx = scaledCanvas.getContext('2d')!;
    scaledCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, scaledCanvas.width, scaledCanvas.height);
    canvas = scaledCanvas;
    ctx = canvas.getContext('2d')!;
  }

  imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedPixels = imageData.data;
  const processedGrayValues = new Uint8ClampedArray(canvas.width * canvas.height);
  minGray = 255;
  maxGray = 0;
  index = 0;

  for (let i = 0; i < processedPixels.length; i += 4) {
    const gray = processedPixels[i];
    processedGrayValues[index++] = gray;
    minGray = Math.min(minGray, gray);
    maxGray = Math.max(maxGray, gray);
  }

  if (maxGray !== minGray) {
    index = 0;
    for (let i = 0; i < processedPixels.length; i += 4) {
      const normalized = Math.round(((processedGrayValues[index] - minGray) / (maxGray - minGray)) * 255);
      const clamped = Math.min(255, Math.max(0, normalized));
      processedPixels[i] = processedPixels[i + 1] = processedPixels[i + 2] = clamped;
      processedPixels[i + 3] = 255;
      processedGrayValues[index++] = clamped;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const histogram = new Uint32Array(256);
  for (let i = 0; i < processedGrayValues.length; i += 1) {
    histogram[processedGrayValues[i]] += 1;
  }

  const totalPixels = canvas.width * canvas.height;
  let sumAll = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    sumAll += i * histogram[i];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let bestThreshold = 0;
  let bestVariance = -1;

  for (let t = 0; t < histogram.length; t += 1) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = totalPixels - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const variance = (weightBackground / totalPixels) * (weightForeground / totalPixels) * Math.pow(meanBackground - meanForeground, 2);

    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = t;
    }
  }

  index = 0;
  for (let i = 0; i < processedPixels.length; i += 4) {
    const binarized = processedGrayValues[index] > bestThreshold ? 255 : 0;
    processedPixels[i] = processedPixels[i + 1] = processedPixels[i + 2] = binarized;
    processedPixels[i + 3] = 255;
    index += 1;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export async function extractTextFromImage(file: File): Promise<OcrResult> {
  const w = await getWorker();
  const blobUrl = URL.createObjectURL(file);
  try {
    const processedCanvas = await preprocessImage(blobUrl);
    const ocrOptions = { tessedit_pageseg_mode: '6' } as any;
    const result = await w.recognize(processedCanvas, ocrOptions);
    const text = result.data.text.trim();
    const confidence = typeof result.data.confidence === 'number' ? result.data.confidence : 0;
    if (!text) throw new Error('No text could be extracted from the image.');
    return { text, confidence };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export async function extractTextFromPDF(file: File): Promise<OcrResult> {
  try {
    const w = await getWorker();
    const ocrOptions = { tessedit_pageseg_mode: '6' } as any;
    const result = await w.recognize(file, ocrOptions);
    const text = result.data.text.trim();
    const confidence = typeof result.data.confidence === 'number' ? result.data.confidence : 0;
    if (text) return { text, confidence };
  } catch {
    // Fall through to pdfjs-dist approach
  }

  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    const pageConfidences: number[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvas, viewport }).promise;
      const processedCanvas = await preprocessImage(canvas);
      const ocrOptions = { tessedit_pageseg_mode: '6' } as any;
      const result = await getWorker().then((w) => w.recognize(processedCanvas, ocrOptions));
      fullText += result.data.text + '\n';
      if (typeof result.data.confidence === 'number') pageConfidences.push(result.data.confidence);
    }

    const trimmed = fullText.trim();
    if (!trimmed) throw new Error('No text could be extracted from the PDF.');
    const averageConfidence = pageConfidences.length > 0
      ? Math.round(pageConfidences.reduce((sum, value) => sum + value, 0) / pageConfidences.length)
      : 0;
    return { text: trimmed, confidence: averageConfidence };
  } catch (err) {
    throw new Error('Failed to process PDF. Please try uploading an image instead.');
  }
}

export async function detectBlur(imageSource: string | HTMLCanvasElement | HTMLImageElement): Promise<{ isBlurry: boolean; sharpness: number }> {
  const canvas = await createCanvasFromSource(imageSource);
  const longestSide = Math.max(canvas.width, canvas.height);
  let workingCanvas = canvas;
  if (longestSide > 800) {
    const scale = 800 / longestSide;
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = Math.round(canvas.width * scale);
    scaledCanvas.height = Math.round(canvas.height * scale);
    const scaledCtx = scaledCanvas.getContext('2d')!;
    scaledCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, scaledCanvas.width, scaledCanvas.height);
    workingCanvas = scaledCanvas;
  }

  const ctx = workingCanvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
  const pixels = imageData.data;
  const grayValues = new Uint8ClampedArray(workingCanvas.width * workingCanvas.height);
  let index = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    grayValues[index++] = gray;
  }

  const width = workingCanvas.width;
  const height = workingCanvas.height;
  if (width < 3 || height < 3) {
    return { isBlurry: false, sharpness: 0 };
  }

  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const laplacian =
        grayValues[idx - 1] +
        grayValues[idx + 1] +
        grayValues[idx - width] +
        grayValues[idx + width] -
        4 * grayValues[idx];
      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count += 1;
    }
  }

  const mean = sum / count;
  const variance = Math.max(0, sumSquares / count - mean * mean);
  const sharpness = Math.round(variance);
  return { isBlurry: sharpness < 100, sharpness };
}

export function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
