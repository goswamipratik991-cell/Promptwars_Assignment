import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Lock,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { AnalysisResult, Finding, LanguageCode } from '../../shared/types';
import type { SampleReport } from '../../samples/reports';
import {
  analyzeReportStream,
  confirmValuesAndRetriage,
  ingestBase64FileReport,
  ingestTextReport,
  type PipelineProgressEvent,
  type UploadedFilePayload,
} from '../lib/api';
import { previewClientRedaction } from '../lib/clientRedact';

interface UploadWorkspaceProps {
  samples: SampleReport[];
  language: LanguageCode;
  onAnalysisReady: (reportId: string, analysis: AnalysisResult) => void;
  onOpenSafetyScope: () => void;
}

const PIPELINE_STEPS = [
  { key: 'ocr', label: 'Ingest & Redact' },
  { key: 'extract', label: 'Extract Values' },
  { key: 'triage', label: 'Deterministic Triage' },
  { key: 'explain', label: 'Plain Explanation' },
  { key: 'critic', label: 'Safety Critic' },
  { key: 'questions', label: 'Visit Questions' },
];

export function UploadWorkspace({
  samples,
  language,
  onAnalysisReady,
  onOpenSafetyScope,
}: UploadWorkspaceProps) {
  const [textInput, setTextInput] = useState('');
  const [uploadedFile, setUploadedFile] = useState<UploadedFilePayload | null>(null);
  const [loadedTxtFileName, setLoadedTxtFileName] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showRedactedPreview, setShowRedactedPreview] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<PipelineProgressEvent | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refusalMsg, setRefusalMsg] = useState<string | null>(null);

  // Low-confidence / UNREADABLE OCR confirmation step
  const [pendingReportId, setPendingReportId] = useState<string | null>(null);
  const [pendingAnalysis, setPendingAnalysis] = useState<AnalysisResult | null>(null);
  const [editableValues, setEditableValues] = useState<
    Record<string, { value: string; unit: string; reference_range: string }>
  >({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const clientRedaction = useMemo(() => previewClientRedaction(textInput), [textInput]);

  const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

  const resolveAcceptedMime = (file: File): string | null => {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const mime = file.type.toLowerCase();
    if (mime === 'text/plain' || ext === 'txt') return 'text/plain';
    if (mime === 'application/pdf' || ext === 'pdf') return 'application/pdf';
    if (mime === 'image/jpeg' || mime === 'image/jpg' || ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (mime === 'image/png' || ext === 'png') return 'image/png';
    return null;
  };

  const handleFilePick = (file: File | null) => {
    setErrorMsg(null);
    setRefusalMsg(null);
    if (!file) return;

    const resolvedMime = resolveAcceptedMime(file);
    if (!resolvedMime) {
      setErrorMsg(`Unsupported file format ("${file.name}"). Please upload a .pdf, .jpg, .jpeg, .png, or .txt file.`);
      return;
    }

    if (file.size === 0) {
      setErrorMsg(`"${file.name}" is empty (0 bytes). Please select a valid medical report.`);
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setErrorMsg(
        `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which exceeds the 10 MB limit.`,
      );
      return;
    }

    setIsReadingFile(true);
    const reader = new FileReader();

    reader.onerror = () => {
      setIsReadingFile(false);
      setErrorMsg(`Failed to read "${file.name}". Please check file permissions or try another file.`);
    };

    if (resolvedMime === 'text/plain') {
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        if (!text.trim()) {
          setErrorMsg(`"${file.name}" contains no readable text.`);
          setIsReadingFile(false);
          return;
        }
        setUploadedFile(null);
        setLoadedTxtFileName(file.name);
        setTextInput(text);
        setIsReadingFile(false);
      };
      reader.readAsText(file);
      return;
    }

    // Images (.jpg, .jpeg, .png) and .pdf files -> Base64 via readAsDataURL
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = dataUrl.indexOf(',');
      const base64Data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
      if (!base64Data) {
        setErrorMsg(`Failed to encode "${file.name}" as Base64.`);
        setIsReadingFile(false);
        return;
      }
      setLoadedTxtFileName(null);
      setUploadedFile({
        fileName: file.name,
        mimeType: resolvedMime,
        base64Data,
        sizeBytes: file.size,
      });
      setIsReadingFile(false);
    };
    reader.readAsDataURL(file);
  };

  const handleStartAnalysis = async (overrideText?: string) => {
    setErrorMsg(null);
    setRefusalMsg(null);
    setPendingAnalysis(null);
    setPendingReportId(null);

    const effectiveText = overrideText !== undefined ? overrideText : textInput.trim();
    if (!uploadedFile && !effectiveText) {
      setErrorMsg('Please upload a PDF/image/TXT report, paste report text, or pick a sample report below.');
      return;
    }

    setIsProcessing(true);
    setProgress({
      stage: 'ocr',
      message: uploadedFile
        ? `Reading ${uploadedFile.fileName} & redacting personal identifiers...`
        : 'Redacting personal identifiers & reading document...',
      progress: 8,
    });

    try {
      // Send redacted text when pasting text (or loaded .txt) so PII never leaves the browser unnecessarily
      const useBinaryFile = Boolean(uploadedFile) && overrideText === undefined;
      const payloadText =
        effectiveText && !useBinaryFile
          ? previewClientRedaction(effectiveText).redactedText
          : effectiveText;

      const ingested =
        useBinaryFile && uploadedFile
          ? await ingestBase64FileReport(uploadedFile, language)
          : await ingestTextReport(payloadText, language);

      const streamRes = await analyzeReportStream(ingested.report_id, language, (ev) => {
        setProgress(ev);
      });

      if (streamRes.status === 'refused') {
        setRefusalMsg(
          streamRes.refusal_reason ||
            'No recognizable medical lab results or prescriptions were found in this document.',
        );
        setIsProcessing(false);
        return;
      }

      if (streamRes.analysis) {
        const needsCheck =
          streamRes.status === 'needs_confirmation' ||
          streamRes.analysis.findings.some((f) => f.needs_confirmation || f.status === 'UNREADABLE');

        if (needsCheck && !streamRes.analysis.urgent_summary.has_urgent) {
          const initialEdits: Record<string, { value: string; unit: string; reference_range: string }> = {};
          streamRes.analysis.findings
            .filter((f) => f.needs_confirmation || f.status === 'UNREADABLE')
            .forEach((f) => {
              initialEdits[f.id] = {
                value: f.value === 'Unreadable' ? '' : f.value,
                unit: f.unit,
                reference_range: f.reference_range === 'Not printed' ? '' : f.reference_range,
              };
            });
          setEditableValues(initialEdits);
          setPendingReportId(ingested.report_id);
          setPendingAnalysis(streamRes.analysis);
          setIsProcessing(false);
          return;
        }

        onAnalysisReady(ingested.report_id, streamRes.analysis);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to analyze report right now.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmValues = async () => {
    if (!pendingReportId || !pendingAnalysis) return;
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const corrections = Object.entries(editableValues).map(([id, vals]) => ({
        id,
        value: vals.value,
        unit: vals.unit,
        reference_range: vals.reference_range,
      }));
      const updated = await confirmValuesAndRetriage(pendingReportId, corrections, language);
      onAnalysisReady(pendingReportId, updated);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to confirm corrected values.');
    } finally {
      setIsProcessing(false);
    }
  };

  const activeStageIndex = progress
    ? PIPELINE_STEPS.findIndex((s) => s.key === progress.stage)
    : -1;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Hero + Non-blocking First-Run Safety Notice */}
      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-medium text-teal-800">
              NCPL Meditech · Clinical-Safety Report Interpreter
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl [text-wrap:balance]">
              Understand your medical report in plain language, without guesswork.
            </h1>
            <p className="text-base text-slate-600 leading-relaxed">
              Upload a lab report, scan, or prescription. MediMind checks every measurement deterministically against printed ranges and critical safety thresholds before explaining what to ask your doctor.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSafetyScope}
            className="inline-flex items-center gap-2 self-start rounded-md border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="h-4 w-4 text-teal-700" />
            What MediMind Can &amp; Cannot Do
          </button>
        </div>

        {/* 3-Step Flow Indicator */}
        <div className="grid grid-cols-1 gap-3 border-y border-slate-200 py-3 sm:grid-cols-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-teal-800">01</span>
            <span>Upload PDF, photo, or paste report text</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-teal-800">02</span>
            <span>Deterministic triage &amp; OCR confirmation</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-teal-800">03</span>
            <span>Plain explanations, ER mode &amp; doctor questions</span>
          </div>
        </div>
      </section>

      {/* Low-Confidence Value Confirmation Gate */}
      {pendingAnalysis && pendingReportId && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Confirm Low-Confidence or Unreadable Values
              </h2>
              <p className="text-sm text-slate-700 mt-1">
                Some numbers were unclear or flagged as low OCR confidence. Please verify or type the exact printed value from your paper report before finalizing your triage.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {pendingAnalysis.findings
              .filter((f: Finding) => f.needs_confirmation || f.status === 'UNREADABLE')
              .map((f: Finding) => (
                <div
                  key={f.id}
                  className="grid gap-3 rounded-md border border-amber-200 bg-white p-4 sm:grid-cols-4 items-end"
                >
                  <div>
                    <p className="text-xs font-medium text-slate-500">Test Name</p>
                    <p className="text-sm font-semibold text-slate-900">{f.name}</p>
                    <p className="text-[11px] font-mono text-slate-500 truncate">{f.source_quote}</p>
                  </div>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">Printed Value</span>
                    <input
                      type="text"
                      value={editableValues[f.id]?.value ?? ''}
                      onChange={(e) =>
                        setEditableValues((prev) => ({
                          ...prev,
                          [f.id]: { ...prev[f.id], value: e.target.value },
                        }))
                      }
                      placeholder="e.g. 9.1"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">Unit</span>
                    <input
                      type="text"
                      value={editableValues[f.id]?.unit ?? ''}
                      onChange={(e) =>
                        setEditableValues((prev) => ({
                          ...prev,
                          [f.id]: { ...prev[f.id], unit: e.target.value },
                        }))
                      }
                      placeholder="e.g. g/dL"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">Reference Range</span>
                    <input
                      type="text"
                      value={editableValues[f.id]?.reference_range ?? ''}
                      onChange={(e) =>
                        setEditableValues((prev) => ({
                          ...prev,
                          [f.id]: { ...prev[f.id], reference_range: e.target.value },
                        }))
                      }
                      placeholder="e.g. 12.0 - 15.5"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </label>
                </div>
              ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => onAnalysisReady(pendingReportId, pendingAnalysis)}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Keep As Uncertain &amp; Continue
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleConfirmValues}
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              Confirm Values &amp; Re-Triage
            </button>
          </div>
        </section>
      )}

      {/* Main Two-Column Upload + Sample Reports Workspace */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* Left: Input Form (7 cols) */}
        <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-6 space-y-5">
          {/* File Dropzone */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-slate-900">
                Upload Report File (PDF, JPG, PNG, TXT)
              </label>
              <span className="text-xs text-slate-500 font-mono">Max 10 MB</span>
            </div>
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload medical report file dropzone"
              onClick={() => {
                if (!isReadingFile && !isProcessing) {
                  fileInputRef.current?.click();
                }
              }}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !isReadingFile && !isProcessing) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!isDragging) setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
                if (!isReadingFile && !isProcessing) {
                  const f = e.dataTransfer.files?.[0] || null;
                  handleFilePick(f);
                }
              }}
              className={`flex flex-col items-center justify-center rounded-md border border-dashed px-4 py-6 text-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-teal-700 ${
                isDragging
                  ? 'border-teal-700 bg-teal-50/70'
                  : 'border-slate-300 bg-slate-50/70 hover:border-teal-600'
              }`}
            >
              {isReadingFile ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Loader2 className="h-6 w-6 text-teal-700 animate-spin" />
                  <p className="text-sm font-medium text-slate-800">Reading file...</p>
                </div>
              ) : uploadedFile ? (
                <div className="space-y-1">
                  <Upload className="h-6 w-6 text-teal-700 mx-auto mb-1" />
                  <p className="text-sm font-semibold text-slate-900">{uploadedFile.fileName}</p>
                  <p className="text-xs text-slate-500 font-mono">
                    {uploadedFile.mimeType} · {(uploadedFile.sizeBytes / 1024).toFixed(1)} KB · Base64 ready for OCR
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setUploadedFile(null);
                    }}
                    className="text-xs font-medium text-red-700 hover:underline mt-1"
                  >
                    Remove file
                  </button>
                </div>
              ) : loadedTxtFileName ? (
                <div className="space-y-1">
                  <FileText className="h-6 w-6 text-teal-700 mx-auto mb-1" />
                  <p className="text-sm font-semibold text-slate-900">{loadedTxtFileName}</p>
                  <p className="text-xs text-slate-600">
                    Loaded into the text box below · Click or drop another file to replace
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLoadedTxtFileName(null);
                      setTextInput('');
                    }}
                    className="text-xs font-medium text-red-700 hover:underline mt-1"
                  >
                    Clear file
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="h-6 w-6 text-teal-700 mb-2" />
                  <p className="text-sm text-slate-700">
                    Drag &amp; drop a lab report or prescription photo here, or{' '}
                    <span className="font-semibold text-teal-700 underline">
                      click to browse
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Supports .pdf, .jpg, .jpeg, .png, and .txt (up to 10 MB).
                  </p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.txt"
                onChange={(e) => {
                  handleFilePick(e.target.files?.[0] || null);
                  e.target.value = '';
                }}
                className="hidden"
                aria-label="Upload medical report file"
              />
            </div>
          </div>

          {/* Or Paste Report Text */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="report-text-area" className="text-sm font-semibold text-slate-900">
                Or Paste Lab Results / Prescription Text
              </label>
              {textInput.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowRedactedPreview((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-800"
                >
                  {showRedactedPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showRedactedPreview ? 'Hide PII Redaction Preview' : 'Show PII Redaction Preview'}
                </button>
              )}
            </div>

            <textarea
              id="report-text-area"
              rows={8}
              value={textInput}
              onChange={(e) => {
                setTextInput(e.target.value);
                setErrorMsg(null);
                setRefusalMsg(null);
              }}
              placeholder="Paste lab report text or prescription lines here (e.g. Haemoglobin: 9.1 g/dL (12.0 - 15.5) or Serum Potassium: 6.5 mmol/L)..."
              className="w-full rounded-md border border-slate-300 bg-white p-3 text-sm font-mono text-slate-800 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
            />

            {/* On-Device PII Redaction Indicator */}
            {textInput.trim().length > 0 && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                    <Lock className="h-3.5 w-3.5 text-teal-700" />
                    On-Device Privacy Shield: {clientRedaction.redactedCount} personal detail(s) stripped before AI call
                  </span>
                  {clientRedaction.categories.length > 0 && (
                    <span className="text-slate-500">
                      {clientRedaction.categories.join(' · ')}
                    </span>
                  )}
                </div>
                {showRedactedPreview && clientRedaction.redactedCount > 0 && (
                  <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-[11px] font-mono text-slate-600">
                    {clientRedaction.redactedText}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* Errors & Non-Medical Refusal */}
          {errorMsg && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {errorMsg}
            </div>
          )}
          {refusalMsg && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                Unable to Interpret This Document
              </p>
              <p className="text-sm text-slate-700">{refusalMsg}</p>
            </div>
          )}

          {/* SSE Multi-Stage Progress Tracker */}
          {isProcessing && progress && (
            <div className="rounded-md border border-teal-200 bg-teal-50/60 p-4 space-y-3" aria-live="polite">
              <div className="flex items-center justify-between text-xs font-medium text-teal-900">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 text-teal-700 animate-spin shrink-0" />
                  <span>
                    {uploadedFile ? `${uploadedFile.fileName}: ` : ''}
                    {progress.message}
                  </span>
                </span>
                <span className="font-mono tabular-nums">{progress.progress}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-teal-100 overflow-hidden">
                <div
                  className="h-full bg-teal-700 transition-all duration-300"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1">
                {PIPELINE_STEPS.map((st, idx) => {
                  const done = activeStageIndex > idx;
                  const active = activeStageIndex === idx;
                  return (
                    <div
                      key={st.key}
                      className={`text-[11px] flex items-center gap-1 ${
                        done
                          ? 'text-teal-800 font-medium'
                          : active
                            ? 'text-slate-900 font-semibold'
                            : 'text-slate-400'
                      }`}
                    >
                      <CheckCircle2 className={`h-3 w-3 shrink-0 ${done || active ? 'text-teal-700' : 'text-slate-300'}`} />
                      <span className="truncate">{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 pt-1">
            <p className="text-xs text-slate-500">
              Anonymous session · Auto-redacted · Educational use only
            </p>
            <button
              type="button"
              disabled={isProcessing || isReadingFile}
              onClick={() => handleStartAnalysis()}
              className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-teal-700 whitespace-nowrap shrink-0"
            >
              {(isProcessing || isReadingFile) && <Loader2 className="h-4 w-4 animate-spin" />}
              {isReadingFile
                ? 'Reading File...'
                : isProcessing
                  ? 'Analyzing Report...'
                  : 'Analyze Report Safely'}
            </button>
          </div>
        </div>

        {/* Right: 5 Synthetic Sample Reports (5 cols) */}
        <aside className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Synthetic Demo Reports
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Load or immediately test the 5 synthetic clinical scenarios (no real patient data).
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {samples.map((s) => (
              <div key={s.id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{s.title}</p>
                    <p className="text-xs text-slate-500">{s.subtitle}</p>
                  </div>
                  <span
                    className={`text-[11px] font-medium whitespace-nowrap shrink-0 ${
                      s.id === 'sample-critical-potassium'
                        ? 'text-red-700'
                        : s.id === 'sample-normal-cbc'
                          ? 'text-emerald-700'
                          : 'text-slate-600'
                    }`}
                  >
                    {s.badge}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      setUploadedFile(null);
                      setLoadedTxtFileName(null);
                      setTextInput(s.text);
                      setErrorMsg(null);
                      setRefusalMsg(null);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Load Text
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      setUploadedFile(null);
                      setLoadedTxtFileName(null);
                      setTextInput(s.text);
                      handleStartAnalysis(s.text);
                    }}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-800 hover:underline disabled:opacity-50"
                  >
                    Run Analysis →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
