import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { AnalysisResult, LanguageCode, RegionCode } from '../shared/types';
import type { SampleReport } from '../samples/reports';
import { EmergencyView } from './components/EmergencyView';
import { EvalDashboardView, PrivacyView } from './components/PrivacyAndEvals';
import { ResultsDashboard } from './components/ResultsDashboard';
import { SafetyScopeModal } from './components/SafetyScopeModal';
import { ShareModal } from './components/ShareModal';
import { TrendsView } from './components/TrendsView';
import { UploadWorkspace } from './components/UploadWorkspace';
import {
  analyzeReportStream,
  createShareReportLink,
  fetchSamples,
  fetchSharedReport,
} from './lib/api';

type ActiveTab = 'interpret' | 'results' | 'trends' | 'privacy' | 'evals';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('interpret');
  const [samples, setSamples] = useState<SampleReport[]>([]);
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [region, setRegion] = useState<RegionCode>('IN');
  const [largeText, setLargeText] = useState(false);

  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [isSharedMode, setIsSharedMode] = useState(false);
  const [sharedExpiresAt, setSharedExpiresAt] = useState<string | null>(null);
  const [translatingLang, setTranslatingLang] = useState(false);

  const [safetyModalOpen, setSafetyModalOpen] = useState(false);
  const [shareModalData, setShareModalData] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);

  useEffect(() => {
    fetchSamples().then(setSamples).catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');
    if (shareToken) {
      fetchSharedReport(shareToken)
        .then((res) => {
          setAnalysis(res.analysis);
          setIsSharedMode(true);
          setSharedExpiresAt(res.expires_at);
          setActiveTab('results');
          if (res.analysis.urgent_summary.has_urgent) {
            setEmergencyMode(true);
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (largeText) {
      root.classList.add('large-text');
    } else {
      root.classList.remove('large-text');
    }
  }, [largeText]);

  const handleAnalysisReady = (reportId: string, res: AnalysisResult) => {
    setActiveReportId(reportId);
    setAnalysis(res);
    setIsSharedMode(false);
    setActiveTab('results');
    // Surface Emergency Mode toggle prominently; enter immediately if urgent
    setEmergencyMode(res.urgent_summary.has_urgent);
  };

  const handleLanguageChange = async (nextLang: LanguageCode) => {
    setLanguage(nextLang);
    if (activeReportId && analysis && !isSharedMode && activeTab === 'results') {
      setTranslatingLang(true);
      try {
        const res = await analyzeReportStream(activeReportId, nextLang, () => {});
        if (res.analysis) {
          setAnalysis(res.analysis);
        }
      } catch {
        // Keep existing analysis on transient translation error
      } finally {
        setTranslatingLang(false);
      }
    }
  };

  const handleShareWithDoctor = async () => {
    if (!activeReportId) return;
    try {
      const res = await createShareReportLink(activeReportId);
      const fullUrl = `${window.location.origin}${res.share_path}`;
      setShareModalData({ url: fullUrl, expiresAt: res.expires_at });
    } catch {
      // Ignore share error
    }
  };

  const handleNewReport = () => {
    setEmergencyMode(false);
    setIsSharedMode(false);
    setActiveTab('interpret');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={handleNewReport}
            className="text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-teal-700"
          >
            MediMind
          </button>

          {/* Zone 2: Concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600" aria-label="Main navigation">
            <button
              type="button"
              onClick={() => {
                setEmergencyMode(false);
                setActiveTab('interpret');
              }}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                activeTab === 'interpret'
                  ? 'text-teal-800 border-b-2 border-teal-700 font-semibold'
                  : 'hover:text-slate-900'
              }`}
            >
              Interpret
            </button>
            <button
              type="button"
              disabled={!analysis}
              onClick={() => setActiveTab('results')}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors disabled:opacity-40 ${
                activeTab === 'results'
                  ? 'text-teal-800 border-b-2 border-teal-700 font-semibold'
                  : 'hover:text-slate-900'
              }`}
            >
              Results
            </button>
            <button
              type="button"
              onClick={() => {
                setEmergencyMode(false);
                setActiveTab('trends');
              }}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                activeTab === 'trends'
                  ? 'text-teal-800 border-b-2 border-teal-700 font-semibold'
                  : 'hover:text-slate-900'
              }`}
            >
              Trends
            </button>
            <button
              type="button"
              onClick={() => {
                setEmergencyMode(false);
                setActiveTab('privacy');
              }}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                activeTab === 'privacy'
                  ? 'text-teal-800 border-b-2 border-teal-700 font-semibold'
                  : 'hover:text-slate-900'
              }`}
            >
              Privacy
            </button>
            <button
              type="button"
              onClick={() => {
                setEmergencyMode(false);
                setActiveTab('evals');
              }}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                activeTab === 'evals'
                  ? 'text-teal-800 border-b-2 border-teal-700 font-semibold'
                  : 'hover:text-slate-900'
              }`}
            >
              Evals
            </button>
          </nav>

          {/* Zone 3: 1 Primary CTA Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handleNewReport}
              className="rounded-md bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-teal-700"
            >
              New Report
            </button>
          </div>
        </div>
      </header>

      {/* Workspace Controls Toolbar (Language, Emergency Region, Accessibility) */}
      <div className="no-print border-b border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            {/* Language Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-medium">Language:</span>
              <div className="flex items-center gap-1 rounded-md bg-slate-200/70 p-0.5">
                {(
                  [
                    ['en', 'English'],
                    ['hi', 'हिन्दी'],
                    ['bn', 'বাংলা'],
                  ] as const
                ).map(([code, label]) => (
                  <button
                    key={code}
                    type="button"
                    disabled={translatingLang}
                    onClick={() => handleLanguageChange(code)}
                    className={`rounded px-2.5 py-1 font-medium whitespace-nowrap shrink-0 transition-colors ${
                      language === code
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {translatingLang && (
                <span className="text-teal-700 font-medium">Updating language...</span>
              )}
            </div>

            {/* Region Emergency Selector */}
            <label className="flex items-center gap-2">
              <span className="text-slate-500 font-medium">Emergency Region:</span>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value as RegionCode)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800"
              >
                <option value="IN">India (112 / 108)</option>
                <option value="US">United States (911)</option>
                <option value="UK">United Kingdom (999)</option>
              </select>
            </label>
          </div>

          <div className="flex items-center gap-3">
            {isSharedMode && sharedExpiresAt && (
              <span className="text-teal-800 font-medium">
                Read-Only Doctor Share · Expires {new Date(sharedExpiresAt).toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={() => setLargeText((v) => !v)}
              aria-pressed={largeText}
              className={`rounded border px-2.5 py-1 font-semibold whitespace-nowrap shrink-0 ${
                largeText
                  ? 'border-teal-700 bg-teal-50 text-teal-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              A+ Large Text
            </button>
          </div>
        </div>

        {/* Mobile Nav Fallback */}
        <nav className="flex md:hidden items-center gap-4 overflow-x-auto px-6 pb-2.5 text-xs font-medium text-slate-600">
          {(['interpret', 'results', 'trends', 'privacy', 'evals'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              disabled={tab === 'results' && !analysis}
              onClick={() => {
                if (tab !== 'results') setEmergencyMode(false);
                setActiveTab(tab);
              }}
              className={`capitalize whitespace-nowrap shrink-0 ${
                activeTab === tab ? 'text-teal-800 font-semibold underline' : 'disabled:opacity-40'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <main className="flex-1 px-6 py-8">
        <AnimatePresence mode="wait">
          {activeTab === 'interpret' && (
            <motion.div
              key="interpret"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
            >
              <UploadWorkspace
                samples={samples}
                language={language}
                onAnalysisReady={handleAnalysisReady}
                onOpenSafetyScope={() => setSafetyModalOpen(true)}
              />
            </motion.div>
          )}

          {activeTab === 'results' && analysis && (
            <motion.div
              key={emergencyMode ? 'emergency' : 'results'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
            >
              {emergencyMode && analysis.urgent_summary.has_urgent ? (
                <EmergencyView
                  analysis={analysis}
                  region={region}
                  onExitEmergency={() => setEmergencyMode(false)}
                />
              ) : (
                <ResultsDashboard
                  reportId={activeReportId}
                  analysis={analysis}
                  region={region}
                  isSharedReadOnly={isSharedMode}
                  onEnterEmergencyMode={() => setEmergencyMode(true)}
                  onShareWithDoctor={handleShareWithDoctor}
                />
              )}
            </motion.div>
          )}

          {activeTab === 'trends' && (
            <motion.div
              key="trends"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
            >
              <TrendsView onGoToUpload={handleNewReport} />
            </motion.div>
          )}

          {activeTab === 'privacy' && (
            <motion.div
              key="privacy"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
            >
              <PrivacyView
                onSessionWiped={() => {
                  setActiveReportId(null);
                  setAnalysis(null);
                  setEmergencyMode(false);
                }}
              />
            </motion.div>
          )}

          {activeTab === 'evals' && (
            <motion.div
              key="evals"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
            >
              <EvalDashboardView />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Always-visible slim educational disclaimer footer */}
      <footer className="no-print border-t border-slate-200 bg-white px-6 py-3 text-center text-xs text-slate-500">
        Educational explanation only — not medical advice or a diagnosis. Always discuss lab reports and prescriptions with a qualified doctor or pharmacist.
      </footer>

      <SafetyScopeModal open={safetyModalOpen} onClose={() => setSafetyModalOpen(false)} />

      {shareModalData && (
        <ShareModal
          open={Boolean(shareModalData)}
          onClose={() => setShareModalData(null)}
          shareUrl={shareModalData.url}
          expiresAt={shareModalData.expiresAt}
        />
      )}
    </div>
  );
}
