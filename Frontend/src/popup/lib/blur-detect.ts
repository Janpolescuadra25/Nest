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
