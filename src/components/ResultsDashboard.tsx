import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  HelpCircle,
  Info,
  PhoneCall,
  Pill,
  Plus,
  Printer,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  AnalysisResult,
  DoctorQuestion,
  Finding,
  FindingStatus,
  RegionCode,
} from '../../shared/types';
import { EMERGENCY_NUMBERS } from './EmergencyView';
import { RangeBar } from './RangeBar';

interface ResultsDashboardProps {
  reportId: string | null;
  analysis: AnalysisResult;
  region: RegionCode;
  isSharedReadOnly?: boolean;
  onEnterEmergencyMode: () => void;
  onShareWithDoctor: () => void;
}

const STATUS_META: Record<
  FindingStatus,
  { label: string; colorClass: string; Icon: typeof CheckCircle2 }
> = {
  POTENTIALLY_URGENT: {
    label: 'Potentially Urgent',
    colorClass: 'border-red-300 bg-red-50 text-red-800',
    Icon: ShieldAlert,
  },
  ABNORMAL_SIGNIFICANT: {
    label: 'Abnormal (Significant)',
    colorClass: 'border-amber-300 bg-amber-50 text-amber-900',
    Icon: AlertTriangle,
  },
  ABNORMAL_MILD: {
    label: 'Abnormal (Mild)',
    colorClass: 'border-amber-200 bg-amber-50/70 text-amber-800',
    Icon: AlertTriangle,
  },
  NORMAL: {
    label: 'Normal',
    colorClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    Icon: CheckCircle2,
  },
  UNCLASSIFIED_NO_RANGE: {
    label: 'Unclassified (No Range)',
    colorClass: 'border-slate-300 bg-slate-100 text-slate-700',
    Icon: HelpCircle,
  },
  UNREADABLE: {
    label: 'Unreadable / Confirm',
    colorClass: 'border-slate-300 bg-slate-100 text-slate-700',
    Icon: HelpCircle,
  },
};

export function ResultsDashboard({
  reportId,
  analysis,
  region,
  isSharedReadOnly = false,
  onEnterEmergencyMode,
  onShareWithDoctor,
}: ResultsDashboardProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'urgent' | 'abnormal' | 'normal' | 'other'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    analysis.findings.forEach((f) => {
      if (f.status !== 'NORMAL') init[f.id] = true;
    });
    return init;
  });
  const [ledgerOpenIds, setLedgerOpenIds] = useState<Record<string, boolean>>({});
  const [activeGlossaryTerm, setActiveGlossaryTerm] = useState<string | null>(null);

  // Interactive Doctor Questions Checklist
  const [questions, setQuestions] = useState<DoctorQuestion[]>(analysis.questions_for_doctor);
  const [checkedQuestions, setCheckedQuestions] = useState<Record<string, boolean>>({});
  const [newQuestionText, setNewQuestionText] = useState('');
  const [copiedChecklist, setCopiedChecklist] = useState(false);

  const emergency = EMERGENCY_NUMBERS[region];

  const counts = useMemo(() => {
    let urgent = 0;
    let abnormal = 0;
    let normal = 0;
    let other = 0;
    for (const f of analysis.findings) {
      if (f.status === 'POTENTIALLY_URGENT') urgent += 1;
      else if (f.status === 'ABNORMAL_MILD' || f.status === 'ABNORMAL_SIGNIFICANT') abnormal += 1;
      else if (f.status === 'NORMAL') normal += 1;
      else other += 1;
    }
    return { urgent, abnormal, normal, other };
  }, [analysis.findings]);

  const filteredFindings = useMemo(() => {
    return analysis.findings.filter((f) => {
      if (statusFilter === 'urgent' && f.status !== 'POTENTIALLY_URGENT') return false;
      if (
        statusFilter === 'abnormal' &&
        f.status !== 'ABNORMAL_MILD' &&
        f.status !== 'ABNORMAL_SIGNIFICANT'
      ) {
        return false;
      }
      if (statusFilter === 'normal' && f.status !== 'NORMAL') return false;
      if (
        statusFilter === 'other' &&
        f.status !== 'UNCLASSIFIED_NO_RANGE' &&
        f.status !== 'UNREADABLE'
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          f.name.toLowerCase().includes(q) ||
          f.plain_explanation.toLowerCase().includes(q) ||
          f.source_quote.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [analysis.findings, statusFilter, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleLedger = (id: string) => {
    setLedgerOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= questions.length) return;
    const copy = [...questions];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    setQuestions(copy.map((q, i) => ({ ...q, priority: i + 1 })));
  };

  const updateQuestionText = (id: string, val: string) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, question: val } : q)));
  };

  const deleteQuestion = (id: string) => {
    setQuestions((prev) =>
      prev.filter((q) => q.id !== id).map((q, i) => ({ ...q, priority: i + 1 })),
    );
  };

  const addQuestion = () => {
    if (!newQuestionText.trim()) return;
    const next: DoctorQuestion = {
      id: `custom_${Date.now()}`,
      priority: questions.length + 1,
      category: 'understanding',
      question: newQuestionText.trim(),
      why_it_matters: 'Added by you for your appointment.',
      related_finding_ids: [],
    };
    setQuestions((prev) => [...prev, next]);
    setNewQuestionText('');
  };

  const copyChecklist = async () => {
    const text = questions
      .map((q, i) => `${i + 1}. ${q.question}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedChecklist(true);
      setTimeout(() => setCopiedChecklist(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const renderExplanationWithGlossary = (f: Finding) => {
    const relatedTerms = analysis.jargon_glossary.filter(
      (g) => g.found_in === f.id || f.name.toLowerCase().includes(g.term.split(' ')[0].toLowerCase()),
    );
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-700 leading-relaxed">{f.plain_explanation}</p>
        {f.what_it_can_be_associated_with.length > 0 && (
          <div className="text-xs text-slate-600">
            <span className="font-semibold text-slate-800">What a change can be associated with: </span>
            {f.what_it_can_be_associated_with.join(' · ')}
          </div>
        )}
        {relatedTerms.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className="text-xs font-medium text-slate-500">Medical terms:</span>
            {relatedTerms.map((term) => (
              <div key={term.term} className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setActiveGlossaryTerm((cur) => (cur === `${f.id}-${term.term}` ? null : `${f.id}-${term.term}`))
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 underline decoration-dotted hover:text-teal-900"
                >
                  <Info className="h-3 w-3" />
                  {term.term}
                </button>
                {activeGlossaryTerm === `${f.id}-${term.term}` && (
                  <div className="mt-1 max-w-xs rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 shadow-sm">
                    <span className="font-semibold text-slate-900">{term.term}: </span>
                    {term.simple_meaning}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* POTENTIALLY URGENT BANNER */}
      {analysis.urgent_summary.has_urgent && (
        <section
          aria-labelledby="urgent-alert-banner"
          className="rounded-lg border border-red-300 bg-red-50 p-5"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-6 w-6 text-red-700 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <h2 id="urgent-alert-banner" className="text-lg font-bold text-red-900">
                  Potentially Urgent Value Flagged — Contact a Doctor Today
                </h2>
                <p className="text-sm text-red-900/90 leading-relaxed max-w-2xl">
                  {analysis.urgent_summary.recommended_action}
                </p>
                {analysis.urgent_summary.items.length > 0 && (
                  <ul className="pt-1 space-y-1 text-xs font-mono text-red-900">
                    {analysis.urgent_summary.items.map((item) => (
                      <li key={item.finding_id}>
                        • {item.name}: {item.value} {item.unit} — {item.trigger_reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="no-print flex flex-wrap items-center gap-2 shrink-0">
              <a
                href={`tel:${emergency.primary}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-800 whitespace-nowrap shrink-0"
              >
                <PhoneCall className="h-3.5 w-3.5" />
                Call {emergency.primary}
              </a>
              <button
                type="button"
                onClick={onEnterEmergencyMode}
                className="rounded-md border border-red-300 bg-white px-3.5 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 whitespace-nowrap shrink-0"
              >
                Open ER Handover Mode
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Overall Summary & Actions */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="capitalize font-medium text-slate-700">
                {analysis.report_meta.report_type} Report
              </span>
              <span aria-hidden="true">·</span>
              <span>Date: {analysis.report_meta.date || 'Not printed'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                OCR Confidence: {Math.round(analysis.report_meta.ocr_confidence * 100)}%
              </span>
              {analysis.safety.pii_redacted_count !== undefined && analysis.safety.pii_redacted_count > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-teal-800 font-medium">
                    {analysis.safety.pii_redacted_count} PII item(s) redacted
                  </span>
                </>
              )}
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Your Report Explained
            </h1>
          </div>

          <div className="no-print flex flex-wrap items-center gap-2 shrink-0">
            {!isSharedReadOnly && reportId && (
              <button
                type="button"
                onClick={onShareWithDoctor}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share QR (24h)
              </button>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Printer className="h-3.5 w-3.5" />
              Print / Export PDF
            </button>
          </div>
        </div>

        <p className="text-base text-slate-800 leading-relaxed max-w-3xl">
          {analysis.overall_summary}
        </p>

        {/* Triage Breakdown & Safety Verification Bar */}
        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-5">
          <div>
            <p className="text-xs text-slate-500">Potentially Urgent</p>
            <p className={`text-xl font-mono font-semibold tabular-nums ${counts.urgent > 0 ? 'text-red-700' : 'text-slate-900'}`}>
              {counts.urgent}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Abnormal</p>
            <p className={`text-xl font-mono font-semibold tabular-nums ${counts.abnormal > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
              {counts.abnormal}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Normal</p>
            <p className="text-xl font-mono font-semibold tabular-nums text-emerald-700">
              {counts.normal}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Unclassified / Unclear</p>
            <p className="text-xl font-mono font-semibold tabular-nums text-slate-700">
              {counts.other}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Safety Critic Audit</p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-teal-800">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {analysis.safety.fallback_used
                ? 'Safe Template Mode'
                : analysis.safety.critic_passed
                  ? 'Verified Zero-Diagnosis'
                  : 'Audited'}
            </p>
          </div>
        </div>
      </section>

      {/* LAB FINDINGS SECTION */}
      {analysis.findings.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold text-slate-900">
              01. Laboratory Findings &amp; Reference Ranges
            </h2>

            <div className="no-print flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter tests..."
                aria-label="Filter laboratory findings"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
              />
              <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
                {(
                  [
                    ['all', `All (${analysis.findings.length})`],
                    ['urgent', `Urgent (${counts.urgent})`],
                    ['abnormal', `Abnormal (${counts.abnormal})`],
                    ['normal', `Normal (${counts.normal})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusFilter(key)}
                    className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      statusFilter === key
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {filteredFindings.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                No findings match the current filter.
              </div>
            ) : (
              filteredFindings.map((f) => {
                const meta = STATUS_META[f.status];
                const StatusIcon = meta.Icon;
                const isExpanded = Boolean(expandedIds[f.id]);
                const isLedgerOpen = Boolean(ledgerOpenIds[f.id]);

                return (
                  <article
                    key={f.id}
                    className="print-break-inside-avoid rounded-lg border border-slate-200 bg-white p-5 space-y-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      {/* Left: Test name, value, range, status label (icon + text) */}
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h3 className="text-base font-semibold text-slate-900">{f.name}</h3>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${meta.colorClass}`}
                          >
                            <StatusIcon className="h-3.5 w-3.5 shrink-0" />
                            {meta.label}
                          </span>
                          <span className="text-xs text-slate-500">
                            Confidence: <span className="capitalize font-medium">{f.confidence}</span>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                          <span className="font-mono tabular-nums text-lg font-bold text-slate-900">
                            {f.value}{' '}
                            <span className="text-xs font-normal text-slate-500">{f.unit}</span>
                          </span>
                          <span className="text-xs text-slate-500 font-mono tabular-nums">
                            Printed Range: {f.reference_range}
                          </span>
                          <span className="text-xs text-slate-600">{f.status_reason}</span>
                        </div>
                      </div>

                      {/* Middle: Recharts Range Bar */}
                      <div className="shrink-0">
                        <RangeBar finding={f} />
                      </div>

                      {/* Right: Expand & Transparency Ledger Controls */}
                      <div className="no-print flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleLedger(f.id)}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                        >
                          {isLedgerOpen ? 'Hide Why Flagged' : 'Why Flagged'}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleExpand(f.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? 'Hide Details' : 'Explain'}
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Plain-Language Explanation */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 pt-3">
                        {renderExplanationWithGlossary(f)}
                      </div>
                    )}

                    {/* Explain-Why-Flagged Transparency Ledger */}
                    {isLedgerOpen && f.transparency && (
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
                        <p className="font-semibold text-slate-900">
                          Transparency Ledger — Deterministic Rule &amp; AI Boundary
                        </p>
                        <p className="text-slate-700">
                          <span className="font-medium">Verbatim Source Quote: </span>
                          <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
                            {f.transparency.source_quote}
                          </code>
                        </p>
                        <p className="text-slate-700">
                          <span className="font-medium">Deterministic Rule Triggered: </span>
                          <code className="font-mono text-teal-800">{f.transparency.rule_triggered}</code>
                          {f.transparency.unit_conversion_note && ` (${f.transparency.unit_conversion_note})`}
                        </p>
                        <p className="text-slate-600">
                          <span className="font-medium text-slate-800">What AI did: </span>
                          {f.transparency.ai_did}
                        </p>
                        <p className="text-slate-600">
                          <span className="font-medium text-slate-800">What AI did NOT do: </span>
                          {f.transparency.ai_did_not}
                        </p>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* PRESCRIPTION DECODER SECTION */}
      {analysis.medications.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-bold text-slate-900">
              02. Prescription Decoder
            </h2>
            <p className="text-xs font-medium text-amber-800">
              Confirm exact dosing, timing, and interactions with your doctor or pharmacist.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <th className="py-3 px-4 font-medium">Medication</th>
                    <th className="py-3 px-4 font-medium">Strength &amp; Route</th>
                    <th className="py-3 px-4 font-medium">Schedule (Decoded)</th>
                    <th className="py-3 px-4 font-medium">General Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analysis.medications.map((m, idx) => (
                    <tr key={idx} className="align-top">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2 font-semibold text-slate-900">
                          <Pill className="h-4 w-4 text-teal-700 shrink-0" />
                          {m.name}
                        </div>
                        <p className="mt-1 text-[11px] font-mono text-slate-500">{m.source_quote}</p>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-700">
                        {m.strength} · {m.route}
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="font-medium text-slate-900">{m.frequency_plain || m.frequency}</p>
                        <p className="text-xs font-mono text-slate-500">Printed: {m.frequency}</p>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-700 leading-relaxed max-w-xs">
                        {m.purpose_general}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* QUESTIONS FOR YOUR DOCTOR CHECKLIST */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              03. Questions for Your Next Doctor&apos;s Visit
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Edit, reorder, check off, or add your own questions before your appointment.
            </p>
          </div>
          <div className="no-print flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyChecklist}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              {copiedChecklist ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedChecklist ? 'Copied List' : 'Copy Questions'}
            </button>
          </div>
        </div>

        <ol className="space-y-3">
          {questions.map((q, idx) => {
            const checked = Boolean(checkedQuestions[q.id]);
            return (
              <li
                key={q.id}
                className="flex flex-col gap-2 rounded-md border border-slate-200 p-3.5 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex items-start gap-3 flex-1">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setCheckedQuestions((prev) => ({ ...prev, [q.id]: e.target.checked }))
                    }
                    aria-label={`Mark question ${idx + 1} asked`}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-mono font-semibold text-teal-800">#{idx + 1}</span>
                      <span className="capitalize">{q.category}</span>
                    </div>
                    {isSharedReadOnly ? (
                      <p className={`text-sm font-medium ${checked ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                        {q.question}
                      </p>
                    ) : (
                      <input
                        type="text"
                        value={q.question}
                        onChange={(e) => updateQuestionText(q.id, e.target.value)}
                        aria-label={`Edit question ${idx + 1}`}
                        className={`w-full rounded border border-transparent hover:border-slate-200 focus:border-teal-700 focus:outline-none px-1 py-0.5 text-sm font-medium ${
                          checked ? 'line-through text-slate-400' : 'text-slate-900'
                        }`}
                      />
                    )}
                    <p className="text-xs text-slate-500 pl-1">{q.why_it_matters}</p>
                  </div>
                </div>

                {!isSharedReadOnly && (
                  <div className="no-print flex items-center gap-1 shrink-0 self-end sm:self-start">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveQuestion(idx, -1)}
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                      aria-label="Move question up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === questions.length - 1}
                      onClick={() => moveQuestion(idx, 1)}
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                      aria-label="Move question down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteQuestion(q.id)}
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                      aria-label="Remove question"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {!isSharedReadOnly && (
          <div className="no-print flex items-center gap-2 pt-2">
            <input
              type="text"
              value={newQuestionText}
              onChange={(e) => setNewQuestionText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addQuestion();
              }}
              placeholder="Add your own question for the doctor..."
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
            />
            <button
              type="button"
              onClick={addQuestion}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Question
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
