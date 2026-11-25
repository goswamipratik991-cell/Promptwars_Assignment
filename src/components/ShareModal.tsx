import { Check, Copy, ExternalLink, Printer, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  shareUrl: string;
  expiresAt: string;
}

export function ShareModal({ open, onClose, shareUrl, expiresAt }: ShareModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 id="share-modal-title" className="text-lg font-semibold text-slate-900">
              Share Summary with Your Doctor
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Expires automatically in 24 hours ({new Date(expiresAt).toLocaleString()})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close share dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-col items-center gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <QRCodeSVG value={shareUrl} size={172} level="M" />
          </div>
          <p className="text-xs text-slate-600 text-center">
            Your doctor or clinic can scan this QR code to view the redacted lab table, plain-language summary, and your visit questions.
          </p>

          <div className="w-full flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={shareUrl}
              aria-label="Share link URL"
              className="flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-800"
          >
            Open link
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={() => {
              onClose();
              setTimeout(() => window.print(), 100);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
          >
            <Printer className="h-3.5 w-3.5" />
            Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  );
}
