import { ShieldCheck, X } from 'lucide-react';

interface SafetyScopeModalProps {
  open: boolean;
  onClose: () => void;
}

export function SafetyScopeModal({ open, onClose }: SafetyScopeModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="safety-scope-title"
    >
      <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-teal-700 shrink-0" />
            <h2 id="safety-scope-title" className="text-lg font-semibold text-slate-900">
              How MediMind Keeps Clinical Explanations Safe
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-teal-700"
            aria-label="Close safety guide"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm text-slate-700 leading-relaxed">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
              <p className="font-semibold text-slate-900 mb-2">What MediMind Does</p>
              <ul className="space-y-1.5 text-slate-600 list-disc pl-4">
                <li>Compares numbers deterministically against your report&apos;s printed range.</li>
                <li>Checks a curated critical-value table to surface urgent alerts fast.</li>
                <li>Explains medical jargon and prescription schedules in plain language.</li>
                <li>Redacts names, phone numbers, DOB, and MRN before AI processing.</li>
              </ul>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
              <p className="font-semibold text-slate-900 mb-2">What MediMind Never Does</p>
              <ul className="space-y-1.5 text-slate-600 list-disc pl-4">
                <li>Never names a diagnosis or claims &quot;you have&quot; a condition.</li>
                <li>Never invents missing reference ranges or unprinted numbers.</li>
                <li>Never advises starting, stopping, or changing medication doses.</li>
                <li>Never replaces an emergency service or qualified physician.</li>
              </ul>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Educational explanation only — not medical advice. If you experience chest pain, trouble breathing,
            confusion, or fainting, contact emergency medical services immediately.
          </p>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-teal-700 whitespace-nowrap shrink-0"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}
