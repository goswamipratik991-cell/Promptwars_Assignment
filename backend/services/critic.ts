import { Type } from '@google/genai';
import type {
  ExtractionOutput,
  Finding,
  LanguageCode,
  SafetyViolation,
} from '../../shared/types.js';
import { SAFETY_CRITIC_SYSTEM_PROMPT } from '../prompts/prompts.js';
import { DEFAULT_LLM_MODEL, getGeminiClient, withRetry } from './geminiClient.js';

export const BANNED_PHRASE_PATTERNS: Array<{ rule: string; regex: RegExp }> = [
  { rule: 'Diagnostic phrasing ("you have")', regex: /\byou\s+have\b/i },
  { rule: 'Diagnostic phrasing ("you are suffering from")', regex: /\byou\s+are\s+suffering\s+from\b/i },
  { rule: 'Diagnostic phrasing ("this means you")', regex: /\bthis\s+means\s+you\b/i },
  { rule: 'Diagnostic phrasing ("diagnosis is")', regex: /\bdiagnosis\s+is\b/i },
  { rule: 'Medication change advice ("stop taking")', regex: /\bstop\s+taking\b/i },
  { rule: 'Medication dose advice ("increase your dose")', regex: /\bincrease\s+your\s+dose\b/i },
  { rule: 'Medication dose advice ("decrease your dose")', regex: /\bdecrease\s+your\s+dose\b/i },
  { rule: 'Prognosis/certainty claim ("you will")', regex: /\byou\s+will\b/i },
  { rule: 'False reassurance ("nothing to worry about")', regex: /\bnothing\s+to\s+worry\s+about\b/i },
  { rule: 'Overcertainty ("definitely")', regex: /\bdefinitely\b/i },
];

export function runRegexSafetyScan(texts: string[]): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  const combined = texts.join('\n');
  for (const check of BANNED_PHRASE_PATTERNS) {
    const match = combined.match(check.regex);
    if (match) {
      violations.push({
        rule: check.rule,
        span: match[0],
        source: 'regex',
      });
    }
  }
  return violations;
}

export function runNumericGroundingCheck(
  extraction: ExtractionOutput,
  findings: Finding[],
  overallSummary: string,
): SafetyViolation[] {
  const violations: SafetyViolation[] = [];

  // Collect all numbers that legitimately exist in source extraction + deterministic status reasons
  const allowedNumbers = new Set<string>([
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '20', '24', '112', '108', '911', '999',
  ]);

  const addNumbersFromString = (s: string | null | undefined) => {
    if (!s) return;
    const matches = s.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || [];
    for (const m of matches) {
      allowedNumbers.add(m);
      allowedNumbers.add(String(Number(m)));
    }
  };

  addNumbersFromString(extraction.date);
  for (const f of extraction.findings) {
    addNumbersFromString(f.value);
    addNumbersFromString(f.reference_range);
    addNumbersFromString(f.source_quote);
    addNumbersFromString(f.unit);
  }
  for (const m of extraction.medications) {
    addNumbersFromString(m.strength);
    addNumbersFromString(m.frequency);
    addNumbersFromString(m.source_quote);
  }
  for (const f of findings) {
    addNumbersFromString(f.status_reason);
    addNumbersFromString(f.transparency?.unit_conversion_note);
  }

  const checkText = (label: string, text: string) => {
    // Only flag decimals or numbers >= 11 that are not in allowedNumbers (small integers 1-10 appear in prose like "2 to 3 months" or "4 tests")
    const matches = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || [];
    for (const rawNum of matches) {
      const normalized = String(Number(rawNum));
      const isDecimal = rawNum.includes('.');
      const numVal = Number(rawNum);
      if ((isDecimal || numVal > 10) && !allowedNumbers.has(rawNum) && !allowedNumbers.has(normalized)) {
        violations.push({
          rule: `Unverified number in ${label} not found in source report`,
          span: rawNum,
          source: 'numeric_grounding',
        });
      }
    }
  };

  for (const f of findings) {
    checkText(`finding ${f.name}`, f.plain_explanation);
  }
  checkText('overall_summary', overallSummary);

  return violations;
}

export function computeFleschKincaidGrade(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  const sentences = clean.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = clean.match(/[A-Za-z]+/g) || [];
  if (sentences.length === 0 || words.length === 0) return 6.0;

  let syllables = 0;
  for (const word of words) {
    const w = word.toLowerCase().replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const syl = w.match(/[aeiouy]{1,2}/g);
    syllables += syl ? syl.length : 1;
  }

  const grade =
    0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
  return Number(Math.max(1, grade).toFixed(1));
}

export async function runSafetyCritic(params: {
  extraction: ExtractionOutput;
  findings: Finding[];
  overallSummary: string;
  language: LanguageCode;
  skipLlmCritic?: boolean;
}): Promise<{
  critic_passed: boolean;
  violations: SafetyViolation[];
}> {
  const texts = [
    params.overallSummary,
    ...params.findings.map((f) => f.plain_explanation),
    ...params.findings.flatMap((f) => f.what_it_can_be_associated_with),
  ];

  const regexViolations = params.language === 'en' ? runRegexSafetyScan(texts) : [];
  const numericViolations = runNumericGroundingCheck(
    params.extraction,
    params.findings,
    params.overallSummary,
  );

  const combinedViolations: SafetyViolation[] = [...regexViolations, ...numericViolations];

  if (params.skipLlmCritic || !process.env.GEMINI_API_KEY) {
    return {
      critic_passed: combinedViolations.length === 0,
      violations: combinedViolations,
    };
  }

  try {
    const ai = getGeminiClient();
    const auditPayload = {
      original_extraction: params.extraction,
      deterministic_statuses: params.findings.map((f) => ({
        id: f.id,
        name: f.name,
        value: f.value,
        unit: f.unit,
        reference_range: f.reference_range,
        status: f.status,
      })),
      candidate_output: {
        overall_summary: params.overallSummary,
        findings_explanations: params.findings.map((f) => ({
          id: f.id,
          status: f.status,
          plain_explanation: f.plain_explanation,
          what_it_can_be_associated_with: f.what_it_can_be_associated_with,
        })),
      },
    };

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: DEFAULT_LLM_MODEL,
        contents: `Audit this patient-facing medical report explanation:\n${JSON.stringify(auditPayload)}`,
        config: {
          systemInstruction: SAFETY_CRITIC_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              critic_passed: { type: Type.BOOLEAN },
              violations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    rule: { type: Type.STRING },
                    span: { type: Type.STRING },
                  },
                  required: ['rule', 'span'],
                },
              },
            },
            required: ['critic_passed', 'violations'],
          },
          seed: 42,
        },
      }),
    );

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      critic_passed?: boolean;
      violations?: Array<{ rule: string; span: string }>;
    };

    if (parsed.critic_passed === false && Array.isArray(parsed.violations)) {
      for (const v of parsed.violations) {
        combinedViolations.push({
          rule: v.rule,
          span: v.span,
          source: 'llm_critic',
        });
      }
    }
  } catch {
    // If LLM critic transiently errors, deterministic regex + numeric grounding still protect output
  }

  return {
    critic_passed: combinedViolations.length === 0,
    violations: combinedViolations,
  };
}
