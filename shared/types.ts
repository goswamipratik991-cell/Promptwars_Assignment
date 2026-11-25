export type ReportType = 'lab' | 'imaging' | 'prescription' | 'discharge' | 'other';

export type LanguageCode = 'en' | 'hi' | 'bn';

export type RegionCode = 'IN' | 'US' | 'UK';

export type FindingStatus =
  | 'NORMAL'
  | 'ABNORMAL_MILD'
  | 'ABNORMAL_SIGNIFICANT'
  | 'POTENTIALLY_URGENT'
  | 'UNCLASSIFIED_NO_RANGE'
  | 'UNREADABLE';

export type FindingDirection = 'LOW' | 'HIGH' | 'NORMAL' | 'UNKNOWN';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ReportMeta {
  report_type: ReportType;
  date: string | null;
  language: LanguageCode;
  ocr_confidence: number;
  title?: string;
  is_medical_document: boolean;
  refusal_reason?: string | null;
}

export interface TransparencyEntry {
  finding_id: string;
  source_quote: string;
  rule_triggered: string;
  matched_critical_analyte?: string | null;
  unit_conversion_note?: string | null;
  ai_did: string;
  ai_did_not: string;
  critic_disagreement?: boolean;
}

export interface Finding {
  id: string;
  name: string;
  value: string;
  numeric_value?: number | null;
  unit: string;
  reference_range: string;
  range_min?: number | null;
  range_max?: number | null;
  source_quote: string;
  status: FindingStatus;
  status_reason: string;
  direction: FindingDirection;
  plain_explanation: string;
  what_it_can_be_associated_with: string[];
  what_to_ask?: string;
  confidence: ConfidenceLevel;
  needs_confirmation?: boolean;
  transparency?: TransparencyEntry;
}

export interface Medication {
  name: string;
  strength: string;
  frequency: string;
  frequency_plain?: string;
  route: string;
  purpose_general: string;
  source_quote: string;
  pharmacist_note?: string;
}

export interface JargonTerm {
  term: string;
  simple_meaning: string;
  found_in: string;
}

export interface UrgentItem {
  finding_id: string;
  name: string;
  value: string;
  unit: string;
  trigger_reason: string;
  source_quote: string;
}

export interface UrgentSummary {
  has_urgent: boolean;
  items: UrgentItem[];
  recommended_action: string;
}

export interface DoctorQuestion {
  id: string;
  priority: number;
  category:
    | 'understanding'
    | 'causes'
    | 'followup'
    | 'lifestyle'
    | 'timeline'
    | 'medication';
  question: string;
  why_it_matters: string;
  related_finding_ids: string[];
}

export interface SafetyViolation {
  rule: string;
  span: string;
  source: 'regex' | 'numeric_grounding' | 'llm_critic' | 'status_override';
}

export interface SafetyReport {
  critic_passed: boolean;
  fallback_used?: boolean;
  regeneration_attempts?: number;
  violations: SafetyViolation[];
  disclaimer: string;
  pii_redacted_count?: number;
  redacted_categories?: string[];
}

export interface AnalysisResult {
  report_meta: ReportMeta;
  findings: Finding[];
  medications: Medication[];
  jargon_glossary: JargonTerm[];
  urgent_summary: UrgentSummary;
  overall_summary: string;
  questions_for_doctor: DoctorQuestion[];
  safety: SafetyReport;
}

export interface ExtractedFindingRaw {
  id: string;
  name: string;
  value: string | null;
  unit: string | null;
  reference_range: string | null;
  source_quote: string;
  ocr_confidence?: ConfidenceLevel;
}

export interface ExtractedMedicationRaw {
  name: string;
  strength: string | null;
  frequency: string | null;
  route: string | null;
  source_quote: string;
}

export interface ExtractionOutput {
  is_medical_document: boolean;
  refusal_reason: string | null;
  report_type: ReportType;
  date: string | null;
  report_alerts_detected: string[];
  findings: ExtractedFindingRaw[];
  medications: ExtractedMedicationRaw[];
}

export interface ReportRecord {
  id: string;
  session_id: string;
  created_at: string;
  filename: string | null;
  source_type: 'text' | 'pdf' | 'image';
  raw_text_redacted: string;
  ocr_confidence: number;
  pii_redacted_count: number;
  redacted_categories: string[];
  language: LanguageCode;
  extraction?: ExtractionOutput;
  analysis?: AnalysisResult;
  status: 'ingested' | 'needs_confirmation' | 'analyzed' | 'refused' | 'error';
  error_message?: string;
}

export interface TrendPoint {
  report_id: string;
  date: string;
  value: number;
  unit: string;
  reference_range: string;
  range_min: number | null;
  range_max: number | null;
  status: FindingStatus;
}

export interface TrendSeries {
  analyte: string;
  unit: string;
  points: TrendPoint[];
}

export interface EvalCaseResult {
  id: string;
  title: string;
  category: string;
  passed: boolean;
  status_matches: number;
  status_total: number;
  zero_diagnosis_passed: boolean;
  hallucination_passed: boolean;
  urgent_recall_passed: boolean;
  injection_resisted: boolean;
  readability_grade: number;
  notes: string[];
}

export interface EvalScorecard {
  run_at: string;
  total_cases: number;
  passed_cases: number;
  status_accuracy_pct: number;
  zero_diagnosis_violations: number;
  hallucination_violations: number;
  urgent_recall_pct: number;
  prompt_injection_pass_pct: number;
  avg_readability_grade: number;
  results: EvalCaseResult[];
}
