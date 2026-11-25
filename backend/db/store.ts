import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  EvalScorecard,
  ReportRecord,
  TrendPoint,
  TrendSeries,
} from '../../shared/types.js';

interface ShareLinkRecord {
  token: string;
  report_id: string;
  session_id: string;
  created_at: string;
  expires_at: string;
}

interface StoreState {
  reports: Record<string, ReportRecord>;
  shares: Record<string, ShareLinkRecord>;
  lastEval: EvalScorecard | null;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'medimind-store.json');

let state: StoreState = {
  reports: {},
  shares: {},
  lastEval: null,
};

function loadStore() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw) as StoreState;
      state = {
        reports: parsed.reports || {},
        shares: parsed.shares || {},
        lastEval: parsed.lastEval || null,
      };
    }
  } catch {
    state = { reports: {}, shares: {}, lastEval: null };
  }
}

function saveStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch {
    // Non-fatal in ephemeral containers
  }
}

loadStore();

export function createReport(record: ReportRecord): ReportRecord {
  state.reports[record.id] = record;
  saveStore();
  return record;
}

export function updateReport(record: ReportRecord): ReportRecord {
  state.reports[record.id] = record;
  saveStore();
  return record;
}

export function getReportById(id: string): ReportRecord | null {
  return state.reports[id] ?? null;
}

export function listSessionReports(sessionId: string): ReportRecord[] {
  return Object.values(state.reports)
    .filter((r) => r.session_id === sessionId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function deleteSessionData(sessionId: string): number {
  let deleted = 0;
  for (const [id, rec] of Object.entries(state.reports)) {
    if (rec.session_id === sessionId) {
      delete state.reports[id];
      deleted += 1;
    }
  }
  for (const [tok, sh] of Object.entries(state.shares)) {
    if (sh.session_id === sessionId) {
      delete state.shares[tok];
    }
  }
  saveStore();
  return deleted;
}

export function createShareLink(reportId: string, sessionId: string): ShareLinkRecord {
  const token = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const share: ShareLinkRecord = {
    token,
    report_id: reportId,
    session_id: sessionId,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  };
  state.shares[token] = share;
  saveStore();
  return share;
}

export function getReportByShareToken(token: string): { report: ReportRecord; expires_at: string } | null {
  const share = state.shares[token];
  if (!share) return null;
  if (new Date(share.expires_at).getTime() < Date.now()) {
    delete state.shares[token];
    saveStore();
    return null;
  }
  const report = state.reports[share.report_id];
  if (!report) return null;
  return { report, expires_at: share.expires_at };
}

export function getSessionTrends(sessionId: string, analyteFilter?: string): TrendSeries[] {
  const reports = listSessionReports(sessionId).filter((r) => r.analysis && r.analysis.findings.length > 0);
  const seriesMap = new Map<string, TrendSeries>();

  // Sort chronologically ascending for trend lines
  const chronological = [...reports].reverse();

  for (const rep of chronological) {
    const findings = rep.analysis?.findings ?? [];
    const reportDate = rep.analysis?.report_meta.date || rep.created_at.slice(0, 10);

    for (const f of findings) {
      if (f.numeric_value === null || f.numeric_value === undefined) continue;
      if (analyteFilter && !f.name.toLowerCase().includes(analyteFilter.toLowerCase())) continue;

      const key = f.name.trim().toLowerCase();
      if (!seriesMap.has(key)) {
        seriesMap.set(key, {
          analyte: f.name,
          unit: f.unit,
          points: [],
        });
      }
      const series = seriesMap.get(key)!;
      const point: TrendPoint = {
        report_id: rep.id,
        date: reportDate,
        value: f.numeric_value,
        unit: f.unit,
        reference_range: f.reference_range,
        range_min: f.range_min ?? null,
        range_max: f.range_max ?? null,
        status: f.status,
      };
      series.points.push(point);
    }
  }

  return Array.from(seriesMap.values());
}

export function saveEvalScorecard(scorecard: EvalScorecard): void {
  state.lastEval = scorecard;
  saveStore();
}

export function getLatestEvalScorecard(): EvalScorecard | null {
  return state.lastEval;
}
