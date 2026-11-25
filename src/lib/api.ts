import type {
  AnalysisResult,
  EvalScorecard,
  LanguageCode,
  TrendSeries,
} from '../../shared/types';
import type { SampleReport } from '../../samples/reports';
import { getSessionToken } from './clientRedact';

export interface IngestResponse {
  report_id: string;
  ocr_confidence: number;
  ocr_method: string;
  low_confidence_notes: string[];
  pii_redacted_count: number;
  redacted_categories: string[];
  redacted_preview: string;
}

export interface PipelineProgressEvent {
  stage: string;
  message: string;
  progress: number;
}

export interface SessionReportSummary {
  id: string;
  created_at: string;
  filename: string | null;
  source_type: string;
  status: string;
  report_type: string;
  date: string | null;
  has_urgent: boolean;
  findings_count: number;
  analysis?: AnalysisResult;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-session-token': getSessionToken(),
    ...extra,
  };
}

export async function fetchSamples(): Promise<SampleReport[]> {
  const res = await fetch('/api/samples');
  if (!res.ok) throw new Error('Failed to load sample reports.');
  const data = (await res.json()) as { samples: SampleReport[] };
  return data.samples;
}

export async function ingestTextReport(text: string, language: LanguageCode): Promise<IngestResponse> {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text, language }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to upload report text.');
  return data as IngestResponse;
}

export interface UploadedFilePayload {
  fileName: string;
  mimeType: string;
  base64Data: string;
  sizeBytes: number;
}

export async function ingestBase64FileReport(
  fileData: UploadedFilePayload,
  language: LanguageCode,
): Promise<IngestResponse> {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      fileData: {
        fileName: fileData.fileName,
        mimeType: fileData.mimeType,
        base64Data: fileData.base64Data,
      },
      language,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to upload report file.');
  return data as IngestResponse;
}

export async function ingestFileReport(file: File, language: LanguageCode): Promise<IngestResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('language', language);

  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to upload report file.');
  return data as IngestResponse;
}

export async function analyzeReportStream(
  reportId: string,
  language: LanguageCode,
  onProgress: (ev: PipelineProgressEvent) => void,
): Promise<{
  status: 'analyzed' | 'needs_confirmation' | 'refused';
  analysis?: AnalysisResult;
  refusal_reason?: string;
}> {
  const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/analyze`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ language }),
  });

  if (!res.ok || !res.body) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error || 'Analysis stream failed.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: {
    status: 'analyzed' | 'needs_confirmation' | 'refused';
    analysis?: AnalysisResult;
    refusal_reason?: string;
  } | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const lines = chunk.split('\n');
      let eventType = 'message';
      let dataStr = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        if (line.startsWith('data: ')) dataStr += line.slice(6).trim();
      }
      if (!dataStr) continue;
      const parsed = JSON.parse(dataStr);

      if (eventType === 'progress') {
        onProgress(parsed as PipelineProgressEvent);
      } else if (eventType === 'refused') {
        finalResult = {
          status: 'refused',
          refusal_reason: parsed.refusal_reason,
        };
      } else if (eventType === 'result') {
        finalResult = {
          status: parsed.needs_confirmation ? 'needs_confirmation' : 'analyzed',
          analysis: parsed.analysis as AnalysisResult,
        };
      } else if (eventType === 'error') {
        throw new Error(parsed.error || 'Pipeline error.');
      }
    }
  }

  if (!finalResult) {
    throw new Error('Analysis stream ended unexpectedly.');
  }
  return finalResult;
}

export async function confirmValuesAndRetriage(
  reportId: string,
  corrections: Array<{ id: string; value: string; unit?: string; reference_range?: string }>,
  language: LanguageCode,
): Promise<AnalysisResult> {
  const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/confirm-values`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ corrections, language }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to confirm values.');
  return data.analysis as AnalysisResult;
}

export async function fetchSessionReports(): Promise<SessionReportSummary[]> {
  const res = await fetch('/api/reports', { headers: authHeaders() });
  if (!res.ok) return [];
  const data = (await res.json()) as { reports: SessionReportSummary[] };
  return data.reports;
}

export async function fetchTrends(analyte?: string): Promise<TrendSeries[]> {
  const q = analyte ? `?analyte=${encodeURIComponent(analyte)}` : '';
  const res = await fetch(`/api/trends${q}`, { headers: authHeaders() });
  if (!res.ok) return [];
  const data = (await res.json()) as { series: TrendSeries[] };
  return data.series;
}

export async function createShareReportLink(reportId: string): Promise<{
  token: string;
  expires_at: string;
  share_path: string;
}> {
  const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/share`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not generate share link.');
  return data;
}

export async function fetchSharedReport(token: string): Promise<{
  expires_at: string;
  created_at: string;
  analysis: AnalysisResult;
}> {
  const res = await fetch(`/api/share/${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Shared report not available.');
  return data;
}

export async function wipeSessionData(): Promise<{ deleted_reports: number }> {
  const res = await fetch('/api/session', {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Failed to wipe session data.');
  return data;
}

export async function fetchLatestEvals(): Promise<EvalScorecard> {
  const res = await fetch('/api/evals/latest');
  if (!res.ok) throw new Error('Failed to load evals.');
  const data = (await res.json()) as { scorecard: EvalScorecard };
  return data.scorecard;
}

export async function runEvalsNow(): Promise<EvalScorecard> {
  const res = await fetch('/api/evals/run', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to run evals.');
  const data = (await res.json()) as { scorecard: EvalScorecard };
  return data.scorecard;
}
