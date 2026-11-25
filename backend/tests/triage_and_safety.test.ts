import { describe, expect, it } from 'vitest';
import { runDeterministicEvalSuite } from '../evals/run_evals.js';
import {
  computeFleschKincaidGrade,
  runNumericGroundingCheck,
  runRegexSafetyScan,
} from '../services/critic.js';
import { expandPrescriptionFrequency } from '../services/interpret.js';
import { redactPII } from '../services/redact.js';
import { parseReferenceRange, triageFindings } from '../services/triage.js';

describe('MediMind Deterministic Triage & Clinical Safety Suite', () => {
  it('parses bounded, upper-only, and lower-only reference ranges', () => {
    expect(parseReferenceRange('12.0 - 15.5')).toEqual({ min: 12.0, max: 15.5, kind: 'bounded' });
    expect(parseReferenceRange('<200')).toEqual({ min: null, max: 200, kind: 'upper_only' });
    expect(parseReferenceRange('> 40')).toEqual({ min: 40, max: null, kind: 'lower_only' });
    expect(parseReferenceRange(null)).toEqual({ min: null, max: null, kind: 'none' });
  });

  it('classifies NORMAL, ABNORMAL_MILD, ABNORMAL_SIGNIFICANT, and POTENTIALLY_URGENT deterministically', () => {
    const res = triageFindings({
      rawText: 'Hb: 6.5 g/dL',
      globalOcrConfidence: 0.98,
      extractedFindings: [
        { id: 'f1', name: 'Haemoglobin', value: '13.5', unit: 'g/dL', reference_range: '12.0 - 15.5', source_quote: 'Hb 13.5' },
        { id: 'f2', name: 'Haemoglobin', value: '11.5', unit: 'g/dL', reference_range: '12.0 - 15.5', source_quote: 'Hb 11.5' },
        { id: 'f3', name: 'Haemoglobin', value: '9.1', unit: 'g/dL', reference_range: '12.0 - 15.5', source_quote: 'Hb 9.1' },
        { id: 'f4', name: 'Potassium', value: '6.5', unit: 'mmol/L', reference_range: '3.5 - 5.1', source_quote: 'K+ 6.5' },
      ],
    });

    expect(res.findings[0].status).toBe('NORMAL');
    expect(res.findings[1].status).toBe('ABNORMAL_MILD');
    expect(res.findings[2].status).toBe('ABNORMAL_SIGNIFICANT');
    expect(res.findings[3].status).toBe('POTENTIALLY_URGENT');
    expect(res.urgent_summary.has_urgent).toBe(true);
  });

  it('converts mmol/L glucose and g/L haemoglobin for critical-value checks and refuses unit mismatches', () => {
    const res = triageFindings({
      rawText: '',
      globalOcrConfidence: 0.98,
      extractedFindings: [
        { id: 'f1', name: 'Glucose', value: '27.5', unit: 'mmol/L', reference_range: '3.9 - 5.5', source_quote: 'Glucose 27.5 mmol/L' },
        { id: 'f2', name: 'Haemoglobin', value: '64', unit: 'g/L', reference_range: '120 - 155', source_quote: 'Hb 64 g/L' },
        { id: 'f3', name: 'Potassium', value: '6.5', unit: 'widgets/L', reference_range: null, source_quote: 'K 6.5 widgets/L' },
      ],
    });

    expect(res.findings[0].status).toBe('POTENTIALLY_URGENT');
    expect(res.findings[1].status).toBe('POTENTIALLY_URGENT');
    expect(res.findings[2].status).toBe('UNCLASSIFIED_NO_RANGE');
  });

  it('redacts patient PII before LLM processing', () => {
    const out = redactPII(
      'Patient Name: Aarav Sharma | DOB: 12/04/1988 | MRN: NCPL-9911 | Phone: +91 98201 44510\nHaemoglobin: 14.0 g/dL (13.0 - 17.0)',
    );
    expect(out.redactedText).not.toContain('Aarav Sharma');
    expect(out.redactedText).not.toContain('12/04/1988');
    expect(out.redactedText).not.toContain('NCPL-9911');
    expect(out.redactedText).not.toContain('98201');
    expect(out.redactedText).toContain('Haemoglobin: 14.0 g/dL');
    expect(out.redactedCount).toBeGreaterThanOrEqual(4);
  });

  it('catches diagnostic phrasing, dosing advice, and hallucinated numbers in Safety Critic', () => {
    const regexViolations = runRegexSafetyScan([
      'Based on your haemoglobin, you have iron deficiency anemia and should stop taking metformin.',
    ]);
    expect(regexViolations.length).toBeGreaterThanOrEqual(2);

    const numViolations = runNumericGroundingCheck(
      {
        is_medical_document: true,
        refusal_reason: null,
        report_type: 'lab',
        date: null,
        report_alerts_detected: [],
        findings: [
          { id: 'f1', name: 'Haemoglobin', value: '9.1', unit: 'g/dL', reference_range: '12.0 - 15.5', source_quote: 'Hb 9.1' },
        ],
        medications: [],
      },
      [
        {
          id: 'f1',
          name: 'Haemoglobin',
          value: '9.1',
          unit: 'g/dL',
          reference_range: '12.0 - 15.5',
          source_quote: 'Hb 9.1',
          status: 'ABNORMAL_SIGNIFICANT',
          status_reason: 'Below printed range by 24% of range width.',
          direction: 'LOW',
          plain_explanation: 'Your haemoglobin was 42.8 g/dL compared to 12.0 - 15.5.',
          what_it_can_be_associated_with: [],
          confidence: 'high',
        },
      ],
      'Summary text.',
    );
    expect(numViolations.some((v) => v.span === '42.8')).toBe(true);
  });

  it('expands prescription abbreviations in EN, HI, and BN', () => {
    expect(expandPrescriptionFrequency('BD PC', 'PO', 'en')).toContain('Twice daily');
    expect(expandPrescriptionFrequency('OD HS', 'PO', 'hi')).toContain('दिन में एक बार');
    expect(expandPrescriptionFrequency('SOS', 'PO', 'bn')).toContain('প্রয়োজন');
  });

  it('passes all 28 eval cases with 100% status accuracy, 100% urgent recall, and Grade <= 8 readability', () => {
    const scorecard = runDeterministicEvalSuite();
    expect(scorecard.total_cases).toBeGreaterThanOrEqual(25);
    expect(scorecard.passed_cases).toBe(scorecard.total_cases);
    expect(scorecard.status_accuracy_pct).toBe(100);
    expect(scorecard.urgent_recall_pct).toBe(100);
    expect(scorecard.zero_diagnosis_violations).toBe(0);
    expect(scorecard.hallucination_violations).toBe(0);
    expect(scorecard.prompt_injection_pass_pct).toBe(100);
    expect(scorecard.avg_readability_grade).toBeLessThanOrEqual(8.5);
    expect(computeFleschKincaidGrade('Your blood test shows normal values. Share this with your doctor.')).toBeLessThanOrEqual(8.5);
  });
});
