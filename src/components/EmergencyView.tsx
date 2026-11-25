import { ArrowLeft, PhoneCall, Printer, ShieldAlert } from 'lucide-react';
import type { AnalysisResult, RegionCode } from '../../shared/types';

interface EmergencyViewProps {
  analysis: AnalysisResult;
  region: RegionCode;
  onExitEmergency: () => void;
}

export const EMERGENCY_NUMBERS: Record<
  RegionCode,
  { label: string; primary: string; secondary?: string; secondaryLabel?: string }
> = {
  IN: { label: 'India Emergency', primary: '112', secondary: '108', secondaryLabel: 'Ambulance' },
  US: { label: 'US Emergency', primary: '911' },
  UK: { label: 'UK Emergency', primary: '999' },
};

export function EmergencyView({ analysis, region, onExitEmergency }: EmergencyViewProps) {
  const emergency = EMERGENCY_NUMBERS[region];

  return (
    <section aria-labelledby="emergency-heading" className="mx-auto max-w-4xl space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onExitEmergency}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Full Report
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          <Printer className="h-4 w-4" />
          Print ER Doctor Handover
        </button>
      </div>

      {/* Focused Urgent Escalation Card */}
      <div className="rounded-lg border border-red-300 bg-red-50 p-6">
        <div className="flex items-start gap-3.5">
          <ShieldAlert className="h-6 w-6 text-red-700 shrink-0 mt-0.5" />
          <div className="space-y-3 flex-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-red-800">
                Potentially Urgent Finding Flagged · NCPL Meditech Escalation View
              </p>
              <h1 id="emergency-heading" className="mt-1 text-2xl font-bold text-slate-900">
                Prompt Medical Review Recommended Today
              </h1>
            </div>

            <p className="text-sm text-slate-800 leading-relaxed max-w-2xl">
              {analysis.urgent_summary.recommended_action}
            </p>

            {/* Region-Aware Call Actions */}
            <div className="no-print flex flex-wrap items-center gap-3 pt-1">
              <a
                href={`tel:${emergency.primary}`}
                className="inline-flex items-center gap-2 rounded-md bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 whitespace-nowrap shrink-0"
              >
                <PhoneCall className="h-4 w-4" />
                Call {emergency.primary} ({emergency.label})
              </a>
              {emergency.secondary && (
                <a
                  href={`tel:${emergency.secondary}`}
                  className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-100 whitespace-nowrap shrink-0"
                >
                  <PhoneCall className="h-4 w-4" />
                  Call {emergency.secondary} ({emergency.secondaryLabel})
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* One-Page Printable Hand-to-ER-Doctor Sheet */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Clinical Handover Summary (For Attending Physician / ER)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Report Type: {analysis.report_meta.report_type.toUpperCase()} · Report Date:{' '}
              {analysis.report_meta.date || 'Not printed'} · Deterministic Critical-Threshold Triage
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            OCR Confidence: {Math.round(analysis.report_meta.ocr_confidence * 100)}%
          </span>
        </div>

        {/* Triggering Urgent Findings */}
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            01. Flagged Urgent Threshold Values
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 pr-4 font-medium">Analyte</th>
                  <th className="py-2 pr-4 font-medium">Printed Value</th>
                  <th className="py-2 pr-4 font-medium">Trigger Rule</th>
                  <th className="py-2 font-medium">Verbatim Source Quote</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analysis.urgent_summary.items.map((item) => (
                  <tr key={item.finding_id} className="bg-red-50/40">
                    <td className="py-2.5 pr-4 font-semibold text-slate-900">{item.name}</td>
                    <td className="py-2.5 pr-4 font-mono tabular-nums font-bold text-red-700">
                      {item.value} {item.unit}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-700">{item.trigger_reason}</td>
                    <td className="py-2.5 font-mono text-xs text-slate-600">{item.source_quote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* All Other Abnormal & Normal Values for Quick ER Context */}
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            02. Complete Extracted Measurements
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 pr-4 font-medium">Test</th>
                  <th className="py-2 pr-4 font-medium text-right">Value</th>
                  <th className="py-2 pr-4 font-medium">Unit</th>
                  <th className="py-2 pr-4 font-medium">Printed Range</th>
                  <th className="py-2 font-medium">Deterministic Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analysis.findings.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2 pr-4 font-medium text-slate-900">{f.name}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {f.value}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-600">{f.unit || '—'}</td>
                    <td className="py-2 pr-4 font-mono text-xs tabular-nums text-slate-600">
                      {f.reference_range}
                    </td>
                    <td className="py-2 text-xs font-medium text-slate-700">{f.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Medications if present */}
        {analysis.medications.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">
              03. Listed Medications on Report
            </h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {analysis.medications.map((m, idx) => (
                <li key={idx} className="py-2 flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {m.name} {m.strength}
                  </span>
                  <span className="text-slate-600 font-mono text-xs">
                    {m.frequency} ({m.route})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="border-t border-slate-200 pt-3 text-xs text-slate-500">
          {analysis.safety.disclaimer} Values are quoted verbatim from the uploaded report; no diagnoses are generated by MediMind.
        </p>
      </div>
    </section>
  );
}
