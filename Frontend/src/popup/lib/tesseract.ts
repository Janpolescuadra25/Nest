import Tesseract from 'tesseract.js';

export async function extractTextFromImage(file: File): Promise<string> {
  const result = await Tesseract.recognize(file, 'eng', {
    logger: () => {},
  });

  if (!result.data || !result.data.text || result.data.text.trim().length === 0) {
    throw new Error('No text could be extracted from the image. The image may be too blurry or unreadable.');
  }

  return result.data.text;
}

export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    const result = await Tesseract.recognize(file, 'eng', {
      logger: () => {},
    });

    if (result.data && result.data.text && result.data.text.trim().length > 0) {
      return result.data.text;
    }
  } catch {
    // Fall through to pdfjs-dist approach
  }

  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

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

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/png');
      });

      const pageImage = new File([blob], `page-${i}.png`, { type: 'image/png' });
      const pageText = await extractTextFromImage(pageImage);
      fullText += pageText + '\n';
    }

    if (fullText.trim().length === 0) {
      throw new Error('No text could be extracted from the PDF. The PDF may be image-based or unreadable.');
    }

    return fullText;
  } catch (err) {
    throw new Error('Failed to process PDF. Please try uploading an image instead.');
  }
}
