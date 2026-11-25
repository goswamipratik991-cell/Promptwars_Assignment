import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import type { LanguageCode, ReportRecord } from './shared/types.js';
import {
  createReport,
  createShareLink,
  deleteSessionData,
  getLatestEvalScorecard,
  getReportById,
  getReportByShareToken,
  getSessionTrends,
  listSessionReports,
  saveEvalScorecard,
  updateReport,
} from './backend/db/store.js';
import { runDeterministicEvalSuite } from './backend/evals/run_evals.js';
import { ingestDocument } from './backend/services/ocr.js';
import { runAnalysisPipeline } from './backend/services/pipeline.js';
import { redactPII } from './backend/services/redact.js';
import { SAMPLE_REPORTS } from './samples/reports.js';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'text/plain',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload PDF, PNG, JPG, WEBP, or TXT (max 10 MB).'));
    }
  },
});

// Simple sliding-window rate limiter (60 req/min per IP on /api)
const rateBuckets = new Map<string, number[]>();
function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 60_000;
  const maxReq = 90;
  const timestamps = (rateBuckets.get(ip) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxReq) {
    res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    return;
  }
  timestamps.push(now);
  rateBuckets.set(ip, timestamps);
  next();
}

function getSessionId(req: Request): string {
  const header = req.header('x-session-token') || req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (header && /^[A-Za-z0-9_-]{8,128}$/.test(header)) {
    return header;
  }
  return 'default-demo-session';
}

function parseLanguage(raw: unknown): LanguageCode {
  if (raw === 'hi' || raw === 'bn') return raw;
  return 'en';
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '16mb' }));

  // Request-ID & structured logging middleware (no PII logged)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        const ms = Date.now() - start;
        console.log(`[${requestId}] ${req.method} ${req.path} -> ${res.statusCode} (${ms}ms)`);
      }
    });
    next();
  });

  app.use('/api', rateLimiter);

  // 1. Health Check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'medimind-api',
      gemini_configured: Boolean(process.env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Synthetic Sample Reports
  app.get('/api/samples', (_req, res) => {
    res.json({ samples: SAMPLE_REPORTS });
  });

  // 3. Ingest Report (multipart PDF/image/txt OR JSON text)
  app.post('/api/reports', (req: Request, res: Response) => {
    upload.single('file')(req, res, async (uploadErr: unknown) => {
      if (uploadErr) {
        const message = uploadErr instanceof Error ? uploadErr.message : 'File upload error';
        res.status(400).json({ error: message });
        return;
      }

      try {
        const sessionId = getSessionId(req);
        const language = parseLanguage(req.body?.language);
        const rawTextInput = typeof req.body?.text === 'string' ? req.body.text : undefined;
        const rawFileData = req.body?.fileData as
          | { fileName?: unknown; mimeType?: unknown; base64Data?: unknown }
          | undefined;

        let resolvedBuffer: Buffer | undefined = req.file?.buffer;
        let resolvedMime: string | undefined = req.file?.mimetype;
        let resolvedFilename: string | undefined = req.file?.originalname;

        if (!resolvedBuffer && rawFileData && typeof rawFileData.base64Data === 'string') {
          const mime = typeof rawFileData.mimeType === 'string' ? rawFileData.mimeType.toLowerCase().trim() : '';
          if (!ALLOWED_MIME_TYPES.has(mime)) {
            res.status(400).json({
              error: 'Unsupported file type. Please upload PDF, JPG, PNG, or TXT (max 10 MB).',
            });
            return;
          }
          const cleanB64 = rawFileData.base64Data.replace(/^data:[^;]+;base64,/, '').trim();
          const decoded = Buffer.from(cleanB64, 'base64');
          if (decoded.length === 0) {
            res.status(400).json({ error: 'Uploaded file appears to be empty or corrupted.' });
            return;
          }
          if (decoded.length > MAX_UPLOAD_BYTES) {
            res.status(400).json({ error: 'File exceeds the 10 MB size limit.' });
            return;
          }
          resolvedBuffer = decoded;
          resolvedMime = mime;
          resolvedFilename =
            typeof rawFileData.fileName === 'string' && rawFileData.fileName.trim()
              ? rawFileData.fileName.trim()
              : 'uploaded-report';
        }

        if (!rawTextInput && !resolvedBuffer) {
          res.status(400).json({ error: 'Please upload a medical report file or paste report text.' });
          return;
        }

        const ocr = await ingestDocument({
          text: rawTextInput,
          fileBuffer: resolvedBuffer,
          mimeType: resolvedMime,
          filename: resolvedFilename,
        });

        if (!ocr.text || ocr.text.trim().length < 5) {
          res.status(422).json({
            error: 'Could not extract readable text from this file. Please try a clearer photo or paste the text directly.',
          });
          return;
        }

        // Redact PII before persistence or LLM processing
        const redaction = redactPII(ocr.text);
        const reportId = `rep_${crypto.randomBytes(8).toString('hex')}`;
        const sourceType: ReportRecord['source_type'] = resolvedBuffer
          ? resolvedMime === 'application/pdf'
            ? 'pdf'
            : resolvedMime?.startsWith('image/')
              ? 'image'
              : 'text'
          : 'text';

        const record: ReportRecord = {
          id: reportId,
          session_id: sessionId,
          created_at: new Date().toISOString(),
          filename: resolvedFilename ?? null,
          source_type: sourceType,
          raw_text_redacted: redaction.redactedText,
          ocr_confidence: ocr.ocr_confidence,
          pii_redacted_count: redaction.redactedCount,
          redacted_categories: redaction.categories,
          language,
          status: 'ingested',
        };

        createReport(record);

        res.status(201).json({
          report_id: reportId,
          ocr_confidence: ocr.ocr_confidence,
          ocr_method: ocr.method,
          low_confidence_notes: ocr.low_confidence_notes,
          pii_redacted_count: redaction.redactedCount,
          redacted_categories: redaction.categories,
          redacted_preview: redaction.redactedText,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to process uploaded report.';
        res.status(500).json({ error: message });
      }
    });
  });

  // 4. Analyze Report with SSE progress streaming (or JSON if ?stream=false)
  app.post('/api/reports/:id/analyze', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const report = getReportById(req.params.id);

    if (!report || report.session_id !== sessionId) {
      res.status(404).json({ error: 'Report not found for this session.' });
      return;
    }

    const language = parseLanguage(req.body?.language ?? report.language);
    const useStream = req.query.stream !== 'false';

    if (!useStream) {
      try {
        const result = await runAnalysisPipeline({
          record: report,
          language,
        });
        report.language = language;
        report.extraction = result.extraction;
        if (result.refused) {
          report.status = 'refused';
          report.error_message = result.refusalReason;
          updateReport(report);
          res.status(422).json({
            status: 'refused',
            refusal_reason: result.refusalReason,
          });
          return;
        }
        report.analysis = result.analysis;
        report.status = result.needsConfirmation ? 'needs_confirmation' : 'analyzed';
        updateReport(report);
        res.json({
          report_id: report.id,
          status: report.status,
          analysis: result.analysis,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Analysis failed.';
        res.status(500).json({ error: msg });
      }
      return;
    }

    // SSE Stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      sendEvent('progress', {
        stage: 'ocr',
        message: 'PII redacted & document text verified.',
        progress: 12,
      });

      const result = await runAnalysisPipeline({
        record: report,
        language,
        onStage: (ev) => sendEvent('progress', ev),
      });

      report.language = language;
      report.extraction = result.extraction;

      if (result.refused) {
        report.status = 'refused';
        report.error_message = result.refusalReason;
        updateReport(report);
        sendEvent('refused', {
          report_id: report.id,
          refusal_reason: result.refusalReason,
        });
        res.end();
        return;
      }

      report.analysis = result.analysis;
      report.status = result.needsConfirmation ? 'needs_confirmation' : 'analyzed';
      updateReport(report);

      sendEvent('result', {
        report_id: report.id,
        status: report.status,
        needs_confirmation: Boolean(result.needsConfirmation),
        analysis: result.analysis,
      });
      res.end();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upstream AI service error.';
      report.status = 'error';
      report.error_message = message;
      updateReport(report);
      sendEvent('error', { error: message });
      res.end();
    }
  });

  // 5. Confirm / Correct Low-Confidence OCR Values & Re-triage
  app.post('/api/reports/:id/confirm-values', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const report = getReportById(req.params.id);

    if (!report || report.session_id !== sessionId) {
      res.status(404).json({ error: 'Report not found for this session.' });
      return;
    }

    if (!report.extraction) {
      res.status(400).json({ error: 'Report has not been extracted yet.' });
      return;
    }

    const corrections = Array.isArray(req.body?.corrections)
      ? (req.body.corrections as Array<{ id: string; value: string; unit?: string; reference_range?: string }>)
      : [];

    const correctionMap = new Map(corrections.map((c) => [c.id, c]));

    const updatedExtraction = {
      ...report.extraction,
      findings: report.extraction.findings.map((f) => {
        const corr = correctionMap.get(f.id);
        if (!corr) return { ...f, ocr_confidence: 'high' as const };
        return {
          ...f,
          value: corr.value.trim(),
          unit: corr.unit !== undefined ? corr.unit.trim() : f.unit,
          reference_range:
            corr.reference_range !== undefined
              ? corr.reference_range.trim() || null
              : f.reference_range,
          ocr_confidence: 'high' as const,
        };
      }),
    };

    try {
      const updatedRecord: ReportRecord = {
        ...report,
        ocr_confidence: Math.max(report.ocr_confidence, 0.95),
        extraction: updatedExtraction,
      };
      const language = parseLanguage(req.body?.language ?? report.language);
      const result = await runAnalysisPipeline({
        record: updatedRecord,
        language,
        existingExtraction: updatedExtraction,
      });

      updatedRecord.language = language;
      updatedRecord.analysis = result.analysis;
      updatedRecord.status = 'analyzed';
      updateReport(updatedRecord);

      res.json({
        report_id: updatedRecord.id,
        status: updatedRecord.status,
        analysis: result.analysis,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to re-triage corrected values.';
      res.status(500).json({ error: message });
    }
  });

  // 6. Get single report & list session reports
  app.get('/api/reports/:id', (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const report = getReportById(req.params.id);
    if (!report || report.session_id !== sessionId) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    res.json({ report });
  });

  app.get('/api/reports', (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const reports = listSessionReports(sessionId).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      filename: r.filename,
      source_type: r.source_type,
      status: r.status,
      report_type: r.analysis?.report_meta.report_type ?? r.extraction?.report_type ?? 'other',
      date: r.analysis?.report_meta.date ?? r.extraction?.date ?? null,
      has_urgent: r.analysis?.urgent_summary.has_urgent ?? false,
      findings_count: r.analysis?.findings.length ?? 0,
      analysis: r.analysis,
    }));
    res.json({ reports });
  });

  // 7. Share with Doctor (24h expiring link)
  app.post('/api/reports/:id/share', (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const report = getReportById(req.params.id);
    if (!report || report.session_id !== sessionId || !report.analysis) {
      res.status(404).json({ error: 'Analyzed report not found.' });
      return;
    }
    const share = createShareLink(report.id, sessionId);
    res.json({
      token: share.token,
      expires_at: share.expires_at,
      share_path: `/?share=${share.token}`,
    });
  });

  app.get('/api/share/:token', (req: Request, res: Response) => {
    const found = getReportByShareToken(req.params.token);
    if (!found || !found.report.analysis) {
      res.status(404).json({ error: 'This shared report link has expired or does not exist.' });
      return;
    }
    res.json({
      expires_at: found.expires_at,
      created_at: found.report.created_at,
      analysis: found.report.analysis,
    });
  });

  // 8. Trends (session-scoped)
  app.get('/api/trends', (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const analyte = typeof req.query.analyte === 'string' ? req.query.analyte : undefined;
    const series = getSessionTrends(sessionId, analyte);
    res.json({ series });
  });

  // 9. Wipe Session Data (privacy control)
  app.delete('/api/session', (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const deletedCount = deleteSessionData(sessionId);
    res.json({ deleted_reports: deletedCount });
  });

  // 10. Dev Eval Dashboard endpoints
  app.get('/api/evals/latest', (_req, res) => {
    let scorecard = getLatestEvalScorecard();
    if (!scorecard) {
      scorecard = runDeterministicEvalSuite();
      saveEvalScorecard(scorecard);
    }
    res.json({ scorecard });
  });

  app.post('/api/evals/run', (_req, res) => {
    const scorecard = runDeterministicEvalSuite();
    saveEvalScorecard(scorecard);
    res.json({ scorecard });
  });

  // Vite dev middleware or production static serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MediMind server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
