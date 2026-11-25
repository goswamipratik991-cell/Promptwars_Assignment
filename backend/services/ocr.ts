import { createRequire } from 'node:module';
import { Type } from '@google/genai';
import { DEFAULT_LLM_MODEL, getGeminiClient, withRetry } from './geminiClient.js';

const require = createRequire(import.meta.url);

export interface OcrResult {
  text: string;
  ocr_confidence: number;
  low_confidence_notes: string[];
  method: 'text' | 'pdf_text' | 'gemini_vision_ocr';
}

export function estimateTextQuality(rawText: string): { confidence: number; notes: string[] } {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { confidence: 0, notes: ['Empty document text'] };
  }

  const notes: string[] = [];
  const garbleMatches = trimmed.match(/[□■◆¤§~^]{2,}|\?{3,}/g) || [];
  const suspiciousTokens = trimmed.match(/\b[A-Za-z]+[0-9]+[A-Za-z]+\b/g) || [];

  let confidence = 0.96;
  if (garbleMatches.length > 0) {
    confidence -= Math.min(0.45, garbleMatches.length * 0.12);
    notes.push(`Detected ${garbleMatches.length} unreadable character sequence(s).`);
  }
  if (suspiciousTokens.length > 3) {
    confidence -= Math.min(0.25, (suspiciousTokens.length - 3) * 0.05);
    notes.push('Possible OCR character-digit confusion detected; please double-check values.');
  }
  if (trimmed.length < 30) {
    confidence = Math.min(confidence, 0.72);
    notes.push('Very short input text; ensure the complete report section was included.');
  }

  return {
    confidence: Math.max(0.15, Number(confidence.toFixed(2))),
    notes,
  };
}

async function runVisionOcr(buffer: Buffer, mimeType: string): Promise<OcrResult> {
  const ai = getGeminiClient();
  const base64Data = buffer.toString('base64');

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: DEFAULT_LLM_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text: `Transcribe ALL printed or handwritten medical text in this document verbatim.
Preserve test names, values, units, reference ranges, dates, and prescription lines accurately.
If any number or word is blurry, smudged, or ambiguous, wrap the uncertain part with [UNCERTAIN: best_guess] and note it in low_confidence_notes.
Return ONLY JSON.`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcribed_text: { type: Type.STRING },
            ocr_confidence: {
              type: Type.NUMBER,
              description: 'Estimated legibility score from 0.0 (unreadable) to 1.0 (crystal clear).',
            },
            low_confidence_notes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['transcribed_text', 'ocr_confidence', 'low_confidence_notes'],
        },
      },
    }),
  );

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    transcribed_text?: string;
    ocr_confidence?: number;
    low_confidence_notes?: string[];
  };

  return {
    text: (parsed.transcribed_text ?? '').trim(),
    ocr_confidence: Math.max(0.1, Math.min(1.0, Number(parsed.ocr_confidence ?? 0.75))),
    low_confidence_notes: parsed.low_confidence_notes ?? [],
    method: 'gemini_vision_ocr',
  };
}

export async function ingestDocument(params: {
  text?: string;
  fileBuffer?: Buffer;
  mimeType?: string;
  filename?: string;
}): Promise<OcrResult> {
  if (params.text && params.text.trim().length > 0) {
    const quality = estimateTextQuality(params.text);
    return {
      text: params.text.trim(),
      ocr_confidence: quality.confidence,
      low_confidence_notes: quality.notes,
      method: 'text',
    };
  }

  if (!params.fileBuffer || !params.mimeType) {
    throw new Error('No text or file buffer provided.');
  }

  const mime = params.mimeType.toLowerCase();

  if (mime === 'text/plain') {
    const text = params.fileBuffer.toString('utf8').trim();
    const quality = estimateTextQuality(text);
    return {
      text,
      ocr_confidence: quality.confidence,
      low_confidence_notes: quality.notes,
      method: 'text',
    };
  }

  if (mime === 'application/pdf') {
    try {
      const pdfParseModule = require('pdf-parse') as (dataBuffer: Buffer) => Promise<{ text: string }>;
      const pdfParseFn =
        typeof pdfParseModule === 'function'
          ? pdfParseModule
          : (pdfParseModule as unknown as { default: (b: Buffer) => Promise<{ text: string }> }).default;
      const pdfData = await pdfParseFn(params.fileBuffer);
      const extractedText = (pdfData.text ?? '').trim();
      if (extractedText.length >= 45) {
        const quality = estimateTextQuality(extractedText);
        return {
          text: extractedText,
          ocr_confidence: quality.confidence,
          low_confidence_notes: quality.notes,
          method: 'pdf_text',
        };
      }
    } catch {
      // Fall through to Gemini Vision OCR for scanned or malformed PDFs
    }
    return runVisionOcr(params.fileBuffer, 'application/pdf');
  }

  if (mime.startsWith('image/')) {
    return runVisionOcr(params.fileBuffer, mime);
  }

  throw new Error(`Unsupported file type: ${params.mimeType}`);
}
