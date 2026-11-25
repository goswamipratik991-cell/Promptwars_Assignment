import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ExtractedFindingRaw,
  Finding,
  FindingDirection,
  FindingStatus,
  TransparencyEntry,
  UrgentItem,
  UrgentSummary,
} from '../../shared/types.js';

export interface CriticalValueRule {
  analyte: string;
  aliases: string[];
  canonical_unit: string;
  accepted_units: string[];
  conversions?: Record<string, number>;
  low_critical: number | null;
  high_critical: number | null;
  source_note: string;
}

const CRITICAL_VALUES_PATH = path.resolve(process.cwd(), 'backend/data/critical_values.json');
const CRITICAL_VALUES: CriticalValueRule[] = JSON.parse(
  readFileSync(CRITICAL_VALUES_PATH, 'utf8'),
);

const ALERT_TEXT_PATTERNS = [
  /\bcritical\s*(?:value|alert|result)?\b/i,
  /\bpanic\s*value\b/i,
  /\bcall\s*(?:physician|doctor|md)\s*immediately\b/i,
  /\bstat\s*alert\b/i,
  /\burgent\s*(?:clinical\s*)?review\b/i,
];

export interface ParsedRange {
  min: number | null;
  max: number | null;
  kind: 'bounded' | 'upper_only' | 'lower_only' | 'none';
}

export function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return '';
  return unit
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('µ', 'u')
    .replace('μ', 'u')
    .replace('×', 'x');
}

export function parseNumericValue(raw: string | null | undefined): {
  numeric: number | null;
  isQualitative: boolean;
  isUncertain: boolean;
} {
  if (!raw) return { numeric: null, isQualitative: false, isUncertain: true };
  const cleaned = raw.trim();
  if (/\[UNCERTAIN/i.test(cleaned) || /\?{2,}|blur|illegible/i.test(cleaned)) {
    return { numeric: null, isQualitative: false, isUncertain: true };
  }

  if (/^(negative|positive|non-reactive|reactive|absent|present|trace|normal|clear)$/i.test(cleaned)) {
    return { numeric: null, isQualitative: true, isUncertain: false };
  }

  // Handle "< 0.01" or "> 400" or "6.5 *" or "1,250"
  const match = cleaned.replace(/,/g, '').match(/^[<>≤≥~]?\s*(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return { numeric: null, isQualitative: false, isUncertain: true };
  }
  const num = Number(match[1]);
  if (!Number.isFinite(num)) {
    return { numeric: null, isQualitative: false, isUncertain: true };
  }
  return { numeric: num, isQualitative: false, isUncertain: false };
}

export function parseReferenceRange(rawRange: string | null | undefined): ParsedRange {
  if (!rawRange) return { min: null, max: null, kind: 'none' };
  const s = rawRange.trim().replace(/,/g, '');
  if (!s) return { min: null, max: null, kind: 'none' };

  // Bounded range: "12.0 - 15.5", "12.0-15.5", "12.0 to 15.5", "12.0 – 15.5"
  const boundedMatch = s.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)/i);
  if (boundedMatch) {
    const min = Number(boundedMatch[1]);
    const max = Number(boundedMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      return { min, max, kind: 'bounded' };
    }
  }

  // Upper bound only: "< 200", "<= 5.6", "≤ 200", "Up to 150"
  const upperMatch = s.match(/^(?:<=?|≤|up\s*to)\s*(-?\d+(?:\.\d+)?)/i);
  if (upperMatch) {
    const max = Number(upperMatch[1]);
    if (Number.isFinite(max)) {
      return { min: null, max, kind: 'upper_only' };
    }
  }

  // Lower bound only: "> 40", ">= 60", "≥ 60"
  const lowerMatch = s.match(/^(?:>=?|≥)\s*(-?\d+(?:\.\d+)?)/i);
  if (lowerMatch) {
    const min = Number(lowerMatch[1]);
    if (Number.isFinite(min)) {
      return { min, max: null, kind: 'lower_only' };
    }
  }

  return { min: null, max: null, kind: 'none' };
}

export function findCriticalRule(analyteName: string): CriticalValueRule | null {
  const norm = analyteName.trim().toLowerCase();
  for (const rule of CRITICAL_VALUES) {
    if (rule.analyte.toLowerCase() === norm) return rule;
    for (const alias of rule.aliases) {
      if (norm === alias || norm.includes(alias)) {
        return rule;
      }
    }
  }
  return null;
}

export function convertToCanonicalUnit(
  value: number,
  rawUnit: string | null | undefined,
  rule: CriticalValueRule,
): { convertedValue: number | null; note: string | null; unitMismatch: boolean } {
  const normUnit = normalizeUnit(rawUnit);
  const canonicalNorm = normalizeUnit(rule.canonical_unit);

  if (!normUnit) {
    // Empty unit only allowed if rule accepts empty (e.g. INR)
    if (rule.accepted_units.includes('')) {
      return { convertedValue: value, note: null, unitMismatch: false };
    }
    return {
      convertedValue: null,
      note: `Missing unit on report; expected ${rule.canonical_unit} for critical check.`,
      unitMismatch: true,
    };
  }

  if (normUnit === canonicalNorm || rule.accepted_units.includes(normUnit)) {
    const factor = rule.conversions?.[normUnit];
    if (factor !== undefined) {
      const converted = Number((value * factor).toFixed(4));
      return {
        convertedValue: converted,
        note: `Converted ${value} ${rawUnit} -> ${converted} ${rule.canonical_unit} (factor ${factor}).`,
        unitMismatch: false,
      };
    }
    return { convertedValue: value, note: null, unitMismatch: false };
  }

  return {
    convertedValue: null,
    note: `Unit mismatch: printed "${rawUnit}" vs critical table "${rule.canonical_unit}". Refused to guess.`,
    unitMismatch: true,
  };
}

export function hasReportTextAlert(rawText: string, extractedAlerts: string[] = []): boolean {
  if (extractedAlerts.length > 0) {
    for (const a of extractedAlerts) {
      if (ALERT_TEXT_PATTERNS.some((p) => p.test(a))) return true;
    }
  }
  return ALERT_TEXT_PATTERNS.some((p) => p.test(rawText));
}

export function triageFindings(params: {
  extractedFindings: ExtractedFindingRaw[];
  rawText: string;
  reportAlertsDetected?: string[];
  globalOcrConfidence: number;
  mildThresholdRatio?: number;
}): {
  findings: Finding[];
  urgent_summary: UrgentSummary;
} {
  const mildThresholdRatio = params.mildThresholdRatio ?? 0.2;
  const globalLowOcr = params.globalOcrConfidence < 0.55;
  const textAlertPresent = hasReportTextAlert(params.rawText, params.reportAlertsDetected);

  const urgentItems: UrgentItem[] = [];
  const findings: Finding[] = [];

  for (const raw of params.extractedFindings) {
    const parsedVal = parseNumericValue(raw.value);
    const parsedRange = parseReferenceRange(raw.reference_range);
    const unitStr = raw.unit ?? '';
    const rangeStr = raw.reference_range ?? 'Not printed';
    const valStr = raw.value ?? 'Unreadable';

    const confidence =
      globalLowOcr || raw.ocr_confidence === 'low' || parsedVal.isUncertain
        ? 'low'
        : raw.ocr_confidence === 'medium'
          ? 'medium'
          : 'high';

    let status: FindingStatus = 'UNCLASSIFIED_NO_RANGE';
    let statusReason = 'No printed reference range on report.';
    let direction: FindingDirection = 'UNKNOWN';
    let ruleTriggered = 'NO_RANGE_FALLBACK';
    let matchedCriticalAnalyte: string | null = null;
    let unitConversionNote: string | null = null;
    let needsConfirmation = false;

    // 1. Check UNREADABLE first
    if (confidence === 'low' && parsedVal.numeric === null && !parsedVal.isQualitative) {
      status = 'UNREADABLE';
      statusReason = 'Value could not be reliably read due to low OCR confidence or formatting.';
      ruleTriggered = 'LOW_OCR_CONFIDENCE_UNPARSEABLE';
      needsConfirmation = true;
    } else if (parsedVal.isQualitative) {
      const lowerVal = valStr.toLowerCase();
      if (lowerVal === 'negative' || lowerVal === 'non-reactive' || lowerVal === 'normal' || lowerVal === 'absent') {
        status = 'NORMAL';
        statusReason = `Qualitative result "${valStr}" matches expected non-reactive/normal result.`;
        direction = 'NORMAL';
        ruleTriggered = 'QUALITATIVE_NORMAL';
      } else {
        status = 'UNCLASSIFIED_NO_RANGE';
        statusReason = `Qualitative result "${valStr}" requires clinician context.`;
        ruleTriggered = 'QUALITATIVE_CLINICIAN_REVIEW';
      }
    } else if (parsedVal.numeric !== null) {
      const val = parsedVal.numeric;

      // 2. Check Critical-Value Table first (highest clinical priority)
      const critRule = findCriticalRule(raw.name);
      let criticalMatched = false;

      if (critRule) {
        matchedCriticalAnalyte = critRule.analyte;
        const conv = convertToCanonicalUnit(val, raw.unit, critRule);
        unitConversionNote = conv.note;

        if (!conv.unitMismatch && conv.convertedValue !== null) {
          const cv = conv.convertedValue;
          if (critRule.low_critical !== null && cv < critRule.low_critical) {
            status = 'POTENTIALLY_URGENT';
            direction = 'LOW';
            statusReason = `Value (${val} ${unitStr}) is below critical threshold (< ${critRule.low_critical} ${critRule.canonical_unit}).`;
            ruleTriggered = `CRITICAL_LOW_${critRule.analyte.toUpperCase().replace(/\s+/g, '_')}`;
            criticalMatched = true;
          } else if (critRule.high_critical !== null && cv > critRule.high_critical) {
            status = 'POTENTIALLY_URGENT';
            direction = 'HIGH';
            statusReason = `Value (${val} ${unitStr}) is above critical threshold (> ${critRule.high_critical} ${critRule.canonical_unit}).`;
            ruleTriggered = `CRITICAL_HIGH_${critRule.analyte.toUpperCase().replace(/\s+/g, '_')}`;
            criticalMatched = true;
          }
        }
      }

      // 3. If not matched via critical numbers, compare against printed reference range
      if (!criticalMatched) {
        if (parsedRange.kind === 'bounded' && parsedRange.min !== null && parsedRange.max !== null) {
          const width = parsedRange.max - parsedRange.min;
          if (val >= parsedRange.min && val <= parsedRange.max) {
            status = 'NORMAL';
            direction = 'NORMAL';
            statusReason = `Within printed reference range (${parsedRange.min} - ${parsedRange.max} ${unitStr}).`;
            ruleTriggered = 'WITHIN_PRINTED_RANGE';
          } else if (val < parsedRange.min) {
            direction = 'LOW';
            const deltaPct = Math.round(((parsedRange.min - val) / width) * 100);
            if ((parsedRange.min - val) / width <= mildThresholdRatio) {
              status = 'ABNORMAL_MILD';
              statusReason = `Below printed range by ${deltaPct}% of range width.`;
              ruleTriggered = 'OUTSIDE_RANGE_LE_20_PCT_LOW';
            } else {
              status = 'ABNORMAL_SIGNIFICANT';
              statusReason = `Below printed range by ${deltaPct}% of range width.`;
              ruleTriggered = 'OUTSIDE_RANGE_GT_20_PCT_LOW';
            }
          } else {
            direction = 'HIGH';
            const deltaPct = Math.round(((val - parsedRange.max) / width) * 100);
            if ((val - parsedRange.max) / width <= mildThresholdRatio) {
              status = 'ABNORMAL_MILD';
              statusReason = `Above printed range by ${deltaPct}% of range width.`;
              ruleTriggered = 'OUTSIDE_RANGE_LE_20_PCT_HIGH';
            } else {
              status = 'ABNORMAL_SIGNIFICANT';
              statusReason = `Above printed range by ${deltaPct}% of range width.`;
              ruleTriggered = 'OUTSIDE_RANGE_GT_20_PCT_HIGH';
            }
          }
        } else if (parsedRange.kind === 'upper_only' && parsedRange.max !== null) {
          if (val <= parsedRange.max) {
            status = 'NORMAL';
            direction = 'NORMAL';
            statusReason = `Within printed upper limit (${rangeStr} ${unitStr}).`;
            ruleTriggered = 'WITHIN_UPPER_BOUND';
          } else {
            direction = 'HIGH';
            const denom = Math.max(Math.abs(parsedRange.max), 1);
            const deltaPct = Math.round(((val - parsedRange.max) / denom) * 100);
            status = (val - parsedRange.max) / denom <= mildThresholdRatio ? 'ABNORMAL_MILD' : 'ABNORMAL_SIGNIFICANT';
            statusReason = `Above printed upper limit by ${deltaPct}%.`;
            ruleTriggered = status === 'ABNORMAL_MILD' ? 'ABOVE_UPPER_BOUND_MILD' : 'ABOVE_UPPER_BOUND_SIG';
          }
        } else if (parsedRange.kind === 'lower_only' && parsedRange.min !== null) {
          if (val >= parsedRange.min) {
            status = 'NORMAL';
            direction = 'NORMAL';
            statusReason = `Meets or exceeds printed lower limit (${rangeStr} ${unitStr}).`;
            ruleTriggered = 'WITHIN_LOWER_BOUND';
          } else {
            direction = 'LOW';
            const denom = Math.max(Math.abs(parsedRange.min), 1);
            const deltaPct = Math.round(((parsedRange.min - val) / denom) * 100);
            status = (parsedRange.min - val) / denom <= mildThresholdRatio ? 'ABNORMAL_MILD' : 'ABNORMAL_SIGNIFICANT';
            statusReason = `Below printed lower limit by ${deltaPct}%.`;
            ruleTriggered = status === 'ABNORMAL_MILD' ? 'BELOW_LOWER_BOUND_MILD' : 'BELOW_LOWER_BOUND_SIG';
          }
        } else {
          status = 'UNCLASSIFIED_NO_RANGE';
          direction = 'UNKNOWN';
          statusReason = unitConversionNote
            ? `No usable printed range and ${unitConversionNote}`
            : 'No reference range printed on report and not in critical threshold table.';
          ruleTriggered = 'UNCLASSIFIED_MISSING_RANGE';
        }
      }

      // If report text explicitly includes "CRITICAL VALUE / PANIC VALUE / CALL PHYSICIAN IMMEDIATELY",
      // escalate significant abnormal findings if not already flagged urgent.
      if (textAlertPresent && status === 'ABNORMAL_SIGNIFICANT') {
        status = 'POTENTIALLY_URGENT';
        statusReason = `${statusReason} Report text also contains an urgent laboratory alert notice.`;
        ruleTriggered = `${ruleTriggered}_ESCALATED_BY_REPORT_ALERT`;
      }

      if (confidence === 'low' && status !== 'POTENTIALLY_URGENT') {
        needsConfirmation = true;
      }
    }

    if (status === 'POTENTIALLY_URGENT') {
      urgentItems.push({
        finding_id: raw.id,
        name: raw.name,
        value: valStr,
        unit: unitStr,
        trigger_reason: statusReason,
        source_quote: raw.source_quote,
      });
    }

    const transparency: TransparencyEntry = {
      finding_id: raw.id,
      source_quote: raw.source_quote,
      rule_triggered: ruleTriggered,
      matched_critical_analyte: matchedCriticalAnalyte,
      unit_conversion_note: unitConversionNote,
      ai_did: 'Extracted verbatim text and wrote a plain-language educational summary grounded in this deterministic classification.',
      ai_did_not: 'Did NOT set or alter the triage status, invent reference ranges, or generate a medical diagnosis.',
    };

    findings.push({
      id: raw.id,
      name: raw.name,
      value: valStr,
      numeric_value: parsedVal.numeric,
      unit: unitStr,
      reference_range: rangeStr,
      range_min: parsedRange.min,
      range_max: parsedRange.max,
      source_quote: raw.source_quote,
      status,
      status_reason: statusReason,
      direction,
      plain_explanation: '',
      what_it_can_be_associated_with: [],
      confidence,
      needs_confirmation: needsConfirmation,
      transparency,
    });
  }

  // If report text has explicit panic/critical alert even with 0 critical table matches, still flag urgent summary!
  const hasUrgent = urgentItems.length > 0 || (textAlertPresent && findings.some((f) => f.status !== 'NORMAL'));

  const recommendedAction = hasUrgent
    ? 'Please contact your doctor or local emergency services today. If you feel unwell (chest pain, breathing trouble, confusion, fainting), seek emergency care immediately.'
    : 'Review these results with your healthcare provider at your scheduled follow-up.';

  return {
    findings,
    urgent_summary: {
      has_urgent: hasUrgent,
      items: urgentItems,
      recommended_action: recommendedAction,
    },
  };
}
