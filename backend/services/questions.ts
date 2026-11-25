import { Type } from '@google/genai';
import type {
  DoctorQuestion,
  Finding,
  LanguageCode,
  Medication,
} from '../../shared/types.js';
import { buildQuestionsPrompt } from '../prompts/prompts.js';
import { DEFAULT_LLM_MODEL, getGeminiClient, withRetry } from './geminiClient.js';

export function buildFallbackQuestions(
  findings: Finding[],
  medications: Medication[],
): DoctorQuestion[] {
  const questions: DoctorQuestion[] = [];
  const urgentOrAbnormal = findings.filter(
    (f) => f.status === 'POTENTIALLY_URGENT' || f.status === 'ABNORMAL_SIGNIFICANT' || f.status === 'ABNORMAL_MILD',
  );

  if (urgentOrAbnormal.length > 0) {
    const top = urgentOrAbnormal[0];
    questions.push({
      id: 'q1',
      priority: 1,
      category: 'understanding',
      question: `My ${top.name} result is ${top.value} ${top.unit}. What does this mean for my health right now, and how soon should we address it?`,
      why_it_matters: 'Clarifies immediate next steps for your highest-priority flagged value.',
      related_finding_ids: [top.id],
    });
  }

  questions.push({
    id: 'q2',
    priority: 2,
    category: 'causes',
    question: 'Could anything in my current medications, hydration, supplements, or recent diet explain these results?',
    why_it_matters: 'Everyday factors and medicines frequently shift lab numbers.',
    related_finding_ids: urgentOrAbnormal.map((f) => f.id),
  });

  questions.push({
    id: 'q3',
    priority: 3,
    category: 'followup',
    question: 'Do we need any follow-up tests to confirm or clarify these findings?',
    why_it_matters: 'A single test result often needs context or confirmation before decisions are made.',
    related_finding_ids: urgentOrAbnormal.map((f) => f.id),
  });

  questions.push({
    id: 'q4',
    priority: 4,
    category: 'timeline',
    question: 'When should these tests be repeated to check for changes?',
    why_it_matters: 'Helps you track trends over time with clear timing.',
    related_finding_ids: findings.slice(0, 3).map((f) => f.id),
  });

  questions.push({
    id: 'q5',
    priority: 5,
    category: 'lifestyle',
    question: 'Are there specific symptoms I should watch for, or safe daily habits that support these levels?',
    why_it_matters: 'Gives clear warning signs and practical day-to-day guidance.',
    related_finding_ids: urgentOrAbnormal.map((f) => f.id),
  });

  if (medications.length > 0) {
    questions.push({
      id: 'q6',
      priority: 6,
      category: 'medication',
      question: `For ${medications.map((m) => m.name).slice(0, 3).join(', ')}, what side effects should I watch for, and what should I do if I miss a dose?`,
      why_it_matters: 'Ensures safe, consistent medication use without guesswork.',
      related_finding_ids: [],
    });
  }

  return questions;
}

export async function generateDoctorQuestions(params: {
  findings: Finding[];
  medications: Medication[];
  language: LanguageCode;
}): Promise<DoctorQuestion[]> {
  try {
    const ai = getGeminiClient();
    const systemInstruction = buildQuestionsPrompt(params.language);

    const contextPayload = {
      findings: params.findings.map((f) => ({
        id: f.id,
        name: f.name,
        value: f.value,
        unit: f.unit,
        reference_range: f.reference_range,
        status: f.status,
      })),
      medications: params.medications.map((m) => ({
        name: m.name,
        strength: m.strength,
        frequency: m.frequency_plain || m.frequency,
      })),
    };

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: DEFAULT_LLM_MODEL,
        contents: `Create 5 to 8 prioritized doctor-visit questions for this report:\n${JSON.stringify(contextPayload)}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                priority: { type: Type.INTEGER },
                category: { type: Type.STRING },
                question: { type: Type.STRING },
                why_it_matters: { type: Type.STRING },
                related_finding_ids: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['priority', 'category', 'question', 'why_it_matters', 'related_finding_ids'],
            },
          },
          seed: 42,
        },
      }),
    );

    const parsed = JSON.parse((response.text ?? '[]').trim()) as Array<{
      priority: number;
      category: string;
      question: string;
      why_it_matters: string;
      related_finding_ids: string[];
    }>;

    const validCategories = new Set([
      'understanding',
      'causes',
      'followup',
      'lifestyle',
      'timeline',
      'medication',
    ]);

    if (Array.isArray(parsed) && parsed.length >= 3) {
      return parsed
        .slice(0, 10)
        .map((q, idx) => ({
          id: `q${idx + 1}`,
          priority: q.priority || idx + 1,
          category: (validCategories.has(q.category)
            ? q.category
            : 'understanding') as DoctorQuestion['category'],
          question: q.question,
          why_it_matters: q.why_it_matters,
          related_finding_ids: Array.isArray(q.related_finding_ids) ? q.related_finding_ids : [],
        }))
        .sort((a, b) => a.priority - b.priority);
    }
  } catch {
    // Graceful fallback below
  }

  return buildFallbackQuestions(params.findings, params.medications);
}
