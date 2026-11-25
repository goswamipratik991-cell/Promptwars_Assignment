import { CheckCircle2, Lock, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EvalScorecard } from '../../shared/types';
import { fetchLatestEvals, runEvalsNow, wipeSessionData } from '../lib/api';
import { resetSessionToken } from '../lib/clientRedact';

export function PrivacyView({ onSessionWiped }: { onSessionWiped: () => void }) {
  const [wiping, setWiping] = useState(false);
  const [wipedMsg, setWipedMsg] = useState<string | null>(null);

  const handleWipe = async () => {
    setWiping(true);
    try {
      const res = await wipeSessionData();
      resetSessionToken();
      onSessionWiped();
      setWipedMsg(`Cleared ${res.deleted_reports} report(s) and rotated your anonymous session token.`);
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">Privacy &amp; Data Protection</h1>
        <p className="text-sm text-slate-600">
          MediMind is engineered to minimize personal data exposure from the moment you paste or upload a report.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2">
          <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
            <Lock className="h-4 w-4 text-teal-700" />
            On-Device &amp; Pre-LLM PII Redaction
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Patient names, dates of birth, phone numbers, email addresses, street addresses, and medical record numbers (MRN) are scrubbed before text reaches any language model.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2">
          <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
            <ShieldCheck className="h-4 w-4 text-teal-700" />
            Anonymous Ephemeral Sessions
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Your active session token lives strictly in browser memory (never in localStorage). Shared QR doctor links automatically expire after 24 hours.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Delete Current Session Reports</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Immediately erase all uploaded reports, trend history, and active share links for this session.
          </p>
          {wipedMsg && (
            <p className="mt-2 text-xs font-medium text-emerald-700">{wipedMsg}</p>
          )}
        </div>
        <button
          type="button"
          disabled={wiping}
          onClick={handleWipe}
          className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 whitespace-nowrap shrink-0"
        >
          <Trash2 className="h-4 w-4" />
          {wiping ? 'Clearing...' : 'Delete All Session Data'}
        </button>
      </div>
    </div>
  );
}

export function EvalDashboardView() {
  const [scorecard, setScorecard] = useState<EvalScorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetchLatestEvals()
      .then(setScorecard)
      .finally(() => setLoading(false));
  }, []);

  const handleRerun = async () => {
    setRunning(true);
    try {
      const updated = await runEvalsNow();
      setScorecard(updated);
    } finally {
      setRunning(false);
    }
  };

  if (loading || !scorecard) {
    return (
      <div className="mx-auto max-w-5xl rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
        Loading safety &amp; triage evaluation scorecard...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Clinical Safety &amp; Triage Eval Scorecard
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Automated evaluation across {scorecard.total_cases} synthetic clinical cases · Last run:{' '}
            {new Date(scorecard.run_at).toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={handleRerun}
          className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Running Eval Suite...' : 'Re-Run All 28 Cases'}
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-6">
        <div>
          <p className="text-xs text-slate-500">Cases Passed</p>
          <p className="text-xl font-mono font-bold tabular-nums text-emerald-700">
            {scorecard.passed_cases}/{scorecard.total_cases}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Status Accuracy</p>
          <p className="text-xl font-mono font-bold tabular-nums text-slate-900">
            {scorecard.status_accuracy_pct}%
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Urgent Recall</p>
          <p className="text-xl font-mono font-bold tabular-nums text-slate-900">
            {scorecard.urgent_recall_pct}%
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Diagnosis Violations</p>
          <p className="text-xl font-mono font-bold tabular-nums text-emerald-700">
            {scorecard.zero_diagnosis_violations}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Hallucinations</p>
          <p className="text-xl font-mono font-bold tabular-nums text-emerald-700">
            {scorecard.hallucination_violations}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Avg F-K Grade</p>
          <p className="text-xl font-mono font-bold tabular-nums text-slate-900">
            {scorecard.avg_readability_grade}
          </p>
        </div>
      </div>

      {/* Per-case table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="py-3 px-4 font-medium">Case</th>
                <th className="py-3 px-4 font-medium">Category</th>
                <th className="py-3 px-4 font-medium">Status Match</th>
                <th className="py-3 px-4 font-medium">Zero Diag</th>
                <th className="py-3 px-4 font-medium">Grounded</th>
                <th className="py-3 px-4 font-medium">Grade</th>
                <th className="py-3 px-4 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scorecard.results.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 px-4 font-medium text-slate-900">
                    <span className="font-mono text-slate-400 mr-1.5">{r.id}</span>
                    {r.title}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{r.category}</td>
                  <td className="py-2.5 px-4 font-mono tabular-nums">
                    {r.status_total > 0 ? `${r.status_matches}/${r.status_total}` : 'Refusal'}
                  </td>
                  <td className="py-2.5 px-4">{r.zero_diagnosis_passed ? 'Pass' : 'Fail'}</td>
                  <td className="py-2.5 px-4">{r.hallucination_passed ? 'Pass' : 'Fail'}</td>
                  <td className="py-2.5 px-4 font-mono tabular-nums">{r.readability_grade}</td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        r.passed ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {r.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
