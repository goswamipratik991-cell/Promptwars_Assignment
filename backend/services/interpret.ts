import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Type } from '@google/genai';
import type {
  ExtractedMedicationRaw,
  Finding,
  JargonTerm,
  LanguageCode,
  Medication,
  SafetyViolation,
} from '../../shared/types.js';
import { buildInterpretationPrompt } from '../prompts/prompts.js';
import { DEFAULT_LLM_MODEL, getGeminiClient, withRetry } from './geminiClient.js';

const DRUG_ABBREV_PATH = path.resolve(process.cwd(), 'backend/data/drug_abbrev.json');
const DRUG_ABBREV: Record<string, Record<LanguageCode, string>> = JSON.parse(
  readFileSync(DRUG_ABBREV_PATH, 'utf8'),
);

const GLOSSARY_PATH = path.resolve(process.cwd(), 'backend/data/glossary.json');
const BASE_GLOSSARY: Array<{ term: string; simple_meaning: string }> = JSON.parse(
  readFileSync(GLOSSARY_PATH, 'utf8'),
);

export const EDUCATIONAL_DISCLAIMER: Record<LanguageCode, string> = {
  en: 'Educational explanation only — not medical advice or a diagnosis. Always review these results with a qualified healthcare professional.',
  hi: 'यह केवल शैक्षिक जानकारी है — चिकित्सा सलाह या निदान नहीं। कृपया इन परिणामों की समीक्षा हमेशा अपने डॉक्टर के साथ करें।',
  bn: 'এটি শুধুমাত্র শিক্ষামূলক ব্যাখ্যা — চিকিৎসা পরামর্শ বা রোগ নির্ণয় নয়। সর্বদা আপনার ডাক্তারের সাথে এই ফলাফল আলোচনা করুন।',
};

export function expandPrescriptionFrequency(
  rawFreq: string | null | undefined,
  rawRoute: string | null | undefined,
  language: LanguageCode,
): string {
  const tokens = `${rawFreq ?? ''} ${rawRoute ?? ''}`
    .toUpperCase()
    .split(/[\s,/()-]+/)
    .filter(Boolean);
  const expanded: string[] = [];
  for (const tok of tokens) {
    const entry = DRUG_ABBREV[tok];
    if (entry && entry[language]) {
      expanded.push(entry[language]);
    }
  }
  return expanded.length > 0
    ? expanded.join(' · ')
    : rawFreq || 'As printed on prescription';
}

export function buildConservativeFallbackInterpretation(params: {
  findings: Finding[];
  medications: ExtractedMedicationRaw[];
  language: LanguageCode;
}): {
  findings: Finding[];
  medications: Medication[];
  jargon_glossary: JargonTerm[];
  overall_summary: string;
} {
  const { language } = params;
  const enrichedFindings: Finding[] = params.findings.map((f) => {
    const rangeClause =
      f.reference_range && f.reference_range !== 'Not printed'
        ? `printed reference range (${f.reference_range}${f.unit ? ` ${f.unit}` : ''})`
        : 'no printed reference range on this report';

    let explanation = '';
    if (f.status === 'UNREADABLE') {
      explanation = `${f.name} could not be read reliably from the document (${f.value}). Please confirm the exact printed value on your original report before discussing it with your doctor.`;
    } else if (f.status === 'POTENTIALLY_URGENT') {
      explanation = `${f.name} is recorded as ${f.value} ${f.unit} (${rangeClause}). ${f.status_reason} This report alone cannot tell the cause, so please contact a doctor or local emergency services promptly for clinical evaluation.`;
    } else if (f.status === 'NORMAL') {
      explanation = `${f.name} measures a routine health marker on your report. Your printed value of ${f.value} ${f.unit} falls within the ${rangeClause}. Your doctor can review this alongside your overall health history.`;
    } else if (f.status === 'UNCLASSIFIED_NO_RANGE') {
      explanation = `${f.name} is recorded as ${f.value} ${f.unit}, with ${rangeClause}. Because reference ranges vary by laboratory, your doctor may want to look at this value in context.`;
    } else {
      explanation = `${f.name} is recorded as ${f.value} ${f.unit}, which is outside the ${rangeClause}. A change like this can be associated with several everyday or medical factors, and this report alone cannot tell which applies. Your doctor may want to look at this result and discuss next steps.`;
    }

    return {
      ...f,
      plain_explanation: explanation,
      what_it_can_be_associated_with:
        f.status === 'NORMAL'
          ? ['Values within the printed laboratory range are generally typical for the test']
          : ['Several possible factors can influence this result; this report alone cannot tell which'],
      what_to_ask: `What does my ${f.name} value of ${f.value} ${f.unit} mean in the context of my health?`,
    };
  });

  const medications: Medication[] = params.medications.map((m) => ({
    name: m.name,
    strength: m.strength ?? 'As printed',
    frequency: m.frequency ?? 'As printed',
    frequency_plain: expandPrescriptionFrequency(m.frequency, m.route, language),
    route: m.route ?? 'As printed',
    purpose_general: 'Prescription medication listed on your report; your doctor or pharmacist can explain its specific role for you.',
    source_quote: m.source_quote,
    pharmacist_note: 'Confirm exact dosing, timing, and instructions with your doctor or pharmacist.',
  }));

  const urgentCount = enrichedFindings.filter((f) => f.status === 'POTENTIALLY_URGENT').length;
  const abnormalCount = enrichedFindings.filter(
    (f) => f.status === 'ABNORMAL_MILD' || f.status === 'ABNORMAL_SIGNIFICANT',
  ).length;
  const normalCount = enrichedFindings.filter((f) => f.status === 'NORMAL').length;

  let overallSummary = `Your report lists ${enrichedFindings.length} test finding(s) and ${medications.length} medication(s). `;
  if (urgentCount > 0) {
    overallSummary += `${urgentCount} result(s) crossed critical safety thresholds and need prompt medical review today. `;
  }
  if (abnormalCount > 0) {
    overallSummary += `${abnormalCount} result(s) fall outside the printed reference range, which your doctor may want to look at. `;
  }
  if (normalCount > 0) {
    overallSummary += `${normalCount} result(s) fall within the printed reference range. `;
  }
  overallSummary +=
    'This report alone cannot tell the full picture, so please share these results with your doctor.';

  const glossary: JargonTerm[] = [];
  for (const f of enrichedFindings) {
    const match = BASE_GLOSSARY.find(
      (g) =>
        f.name.toLowerCase().includes(g.term.split(' ')[0].toLowerCase()) ||
        g.term.toLowerCase().includes(f.name.toLowerCase()),
    );
    if (match) {
      glossary.push({
        term: match.term,
        simple_meaning: match.simple_meaning,
        found_in: f.id,
      });
    }
  }

  return {
    findings: enrichedFindings,
    medications,
    jargon_glossary: glossary,
    overall_summary: overallSummary,
  };
}

const INTERPRETATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    findings_explanations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          plain_explanation: { type: Type.STRING },
          what_it_can_be_associated_with: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          what_to_ask: { type: Type.STRING },
        },
        required: ['id', 'plain_explanation', 'what_it_can_be_associated_with', 'what_to_ask'],
      },
    },
    medications_explained: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          purpose_general: { type: Type.STRING },
          frequency_plain: { type: Type.STRING },
        },
        required: ['name', 'purpose_general', 'frequency_plain'],
      },
    },
    jargon_glossary: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          term: { type: Type.STRING },
          simple_meaning: { type: Type.STRING },
          found_in: { type: Type.STRING },
        },
        required: ['term', 'simple_meaning', 'found_in'],
      },
    },
    overall_summary: { type: Type.STRING },
  },
  required: ['findings_explanations', 'medications_explained', 'jargon_glossary', 'overall_summary'],
};

export async function generateInterpretation(params: {
  findings: Finding[];
  medications: ExtractedMedicationRaw[];
  language: LanguageCode;
  priorViolations?: SafetyViolation[];
}): Promise<{
  findings: Finding[];
  medications: Medication[];
  jargon_glossary: JargonTerm[];
  overall_summary: string;
}> {
  const ai = getGeminiClient();
  const systemInstruction = buildInterpretationPrompt(params.language);

  const payload = {
    findings: params.findings.map((f) => ({
      id: f.id,
      name: f.name,
      value: f.value,
      unit: f.unit,
      reference_range: f.reference_range,
      status: f.status,
      status_reason: f.status_reason,
      direction: f.direction,
      confidence: f.confidence,
      source_quote: f.source_quote,
    })),
    medications: params.medications,
  };

  let prompt = `Generate calm, Grade 6-8 plain-language educational explanations grounded ONLY in this deterministic triage data:\n${JSON.stringify(payload, null, 2)}`;

  if (params.priorViolations && params.priorViolations.length > 0) {
    prompt += `\n\nYOUR PREVIOUS DRAFT FAILED SAFETY AUDIT FOR THESE EXACT VIOLATIONS. FIX EVERY ONE OF THEM:\n${JSON.stringify(params.priorViolations, null, 2)}`;
  }

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: DEFAULT_LLM_MODEL,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: INTERPRETATION_SCHEMA,
        seed: 42,
      },
    }),
  );

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    findings_explanations?: Array<{
      id: string;
      plain_explanation: string;
      what_it_can_be_associated_with: string[];
      what_to_ask: string;
    }>;
    medications_explained?: Array<{
      name: string;
      purpose_general: string;
      frequency_plain: string;
    }>;
    jargon_glossary?: JargonTerm[];
    overall_summary?: string;
  };

  const expMap = new Map(
    (parsed.findings_explanations ?? []).map((e) => [e.id, e]),
  );

  const fallback = buildConservativeFallbackInterpretation(params);

  const mergedFindings: Finding[] = params.findings.map((f, idx) => {
    const exp = expMap.get(f.id);
    const fb = fallback.findings[idx];
    return {
      ...f,
      plain_explanation: exp?.plain_explanation?.trim() || fb.plain_explanation,
      what_it_can_be_associated_with:
        exp?.what_it_can_be_associated_with?.length
          ? exp.what_it_can_be_associated_with
          : fb.what_it_can_be_associated_with,
      what_to_ask: exp?.what_to_ask?.trim() || fb.what_to_ask,
    };
  });

  const medExpMap = new Map(
    (parsed.medications_explained ?? []).map((m) => [m.name.toLowerCase(), m]),
  );

  const mergedMedications: Medication[] = params.medications.map((m) => {
    const exp = medExpMap.get(m.name.toLowerCase());
    const deterministicFreq = expandPrescriptionFrequency(m.frequency, m.route, params.language);
    return {
      name: m.name,
      strength: m.strength ?? 'As printed',
      frequency: m.frequency ?? 'As printed',
      frequency_plain: exp?.frequency_plain?.trim() || deterministicFreq,
      route: m.route ?? 'As printed',
      purpose_general:
        exp?.purpose_general?.trim() ||
        'Prescription medicine on your report; ask your doctor or pharmacist how it supports your care.',
      source_quote: m.source_quote,
      pharmacist_note:
        params.language === 'hi'
          ? 'सटीक खुराक और समय की पुष्टि हमेशा अपने डॉक्टर या फार्मासिस्ट से करें।'
          : params.language === 'bn'
            ? 'সঠিক মাত্রা ও সময় সর্বদা আপনার ডাক্তার বা ফার্মাসিস্টের সাথে নিশ্চিত করুন।'
            : 'Confirm exact dosing, timing, and interactions with your doctor or pharmacist.',
    };
  });

  const glossary =
    parsed.jargon_glossary && parsed.jargon_glossary.length > 0
      ? parsed.jargon_glossary
      : fallback.jargon_glossary;

  return {
    findings: mergedFindings,
    medications: mergedMedications,
    jargon_glossary: glossary,
    overall_summary: parsed.overall_summary?.trim() || fallback.overall_summary,
  };
}
