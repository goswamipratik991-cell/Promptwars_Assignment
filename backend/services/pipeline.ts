import type {
  AnalysisResult,
  ExtractionOutput,
  LanguageCode,
  ReportRecord,
} from '../../shared/types.js';
import { runSafetyCritic } from './critic.js';
import { extractMedicalData } from './extract.js';
import {
  EDUCATIONAL_DISCLAIMER,
  buildConservativeFallbackInterpretation,
  generateInterpretation,
} from './interpret.js';
import { generateDoctorQuestions } from './questions.js';
import { triageFindings } from './triage.js';

export type PipelineStage =
  | 'ocr'
  | 'extract'
  | 'triage'
  | 'explain'
  | 'critic'
  | 'questions'
  | 'complete'
  | 'needs_confirmation'
  | 'refused';

export interface StageEvent {
  stage: PipelineStage;
  message: string;
  progress: number;
}

export async function runAnalysisPipeline(params: {
  record: ReportRecord;
  language: LanguageCode;
  existingExtraction?: ExtractionOutput;
  onStage?: (ev: StageEvent) => void;
}): Promise<{
  extraction: ExtractionOutput;
  analysis?: AnalysisResult;
  needsConfirmation?: boolean;
  refused?: boolean;
  refusalReason?: string;
}> {
  const emit = params.onStage ?? (() => {});

  // Stage 2: Structured Extraction (or reuse after user confirmation)
  let extraction = params.existingExtraction;
  if (!extraction) {
    emit({
      stage: 'extract',
      message: 'Extracting verbatim test values, units, ranges, and medications...',
      progress: 25,
    });
    extraction = await extractMedicalData(params.record.raw_text_redacted);
  }

  // Non-medical document graceful refusal
  if (!extraction.is_medical_document) {
    const reason =
      extraction.refusal_reason ||
      'No recognizable medical lab values, clinical findings, or prescriptions were found. Please upload or paste a lab report, discharge summary, or prescription.';
    emit({
      stage: 'refused',
      message: reason,
      progress: 100,
    });
    return {
      extraction,
      refused: true,
      refusalReason: reason,
    };
  }

  // Stage 3: Deterministic Triage (Code-First)
  emit({
    stage: 'triage',
    message: 'Running deterministic range comparison & critical-value safety checks...',
    progress: 45,
  });
  const triage = triageFindings({
    extractedFindings: extraction.findings,
    rawText: params.record.raw_text_redacted,
    reportAlertsDetected: extraction.report_alerts_detected,
    globalOcrConfidence: params.record.ocr_confidence,
  });

  // Check if low-confidence / unreadable items need confirmation (unless user already confirmed)
  const unconfirmedLowConf = triage.findings.some((f) => f.needs_confirmation);
  if (unconfirmedLowConf && !params.existingExtraction) {
    // Still continue generating full safe analysis if urgent items exist, otherwise pause for confirmation
    if (!triage.urgent_summary.has_urgent) {
      // Proceed to build preliminary analysis so UI has full structure, while marking record as needs_confirmation
    }
  }

  // Stage 4: Plain-Language Interpretation
  emit({
    stage: 'explain',
    message: 'Writing calm, Grade 6–8 plain-language explanations grounded in your numbers...',
    progress: 65,
  });

  let interpreted: Awaited<ReturnType<typeof generateInterpretation>>;
  let fallbackUsed = false;
  try {
    interpreted = await generateInterpretation({
      findings: triage.findings,
      medications: extraction.medications,
      language: params.language,
    });
  } catch {
    interpreted = buildConservativeFallbackInterpretation({
      findings: triage.findings,
      medications: extraction.medications,
      language: params.language,
    });
    fallbackUsed = true;
  }

  // Stage 5: Independent Safety Critic + 1 Regeneration Retry + Safe Template Fallback
  emit({
    stage: 'critic',
    message: 'Auditing output for zero diagnoses, dosing safety, and numeric grounding...',
    progress: 82,
  });

  let criticResult = await runSafetyCritic({
    extraction,
    findings: interpreted.findings,
    overallSummary: interpreted.overall_summary,
    language: params.language,
  });

  let regenerationAttempts = 0;
  if (!criticResult.critic_passed && !fallbackUsed) {
    regenerationAttempts = 1;
    try {
      const retried = await generateInterpretation({
        findings: triage.findings,
        medications: extraction.medications,
        language: params.language,
        priorViolations: criticResult.violations,
      });
      const retryCritic = await runSafetyCritic({
        extraction,
        findings: retried.findings,
        overallSummary: retried.overall_summary,
        language: params.language,
      });
      if (retryCritic.critic_passed) {
        interpreted = retried;
        criticResult = retryCritic;
      } else {
        // Conservative deterministic template fallback
        interpreted = buildConservativeFallbackInterpretation({
          findings: triage.findings,
          medications: extraction.medications,
          language: params.language,
        });
        fallbackUsed = true;
        criticResult = await runSafetyCritic({
          extraction,
          findings: interpreted.findings,
          overallSummary: interpreted.overall_summary,
          language: params.language,
          skipLlmCritic: true,
        });
      }
    } catch {
      interpreted = buildConservativeFallbackInterpretation({
        findings: triage.findings,
        medications: extraction.medications,
        language: params.language,
      });
      fallbackUsed = true;
    }
  }

  // Stage 6: Doctor-Visit Question Generator
  emit({
    stage: 'questions',
    message: 'Preparing prioritized questions for your doctor appointment...',
    progress: 92,
  });
  const questions = await generateDoctorQuestions({
    findings: interpreted.findings,
    medications: interpreted.medications,
    language: params.language,
  });

  const analysis: AnalysisResult = {
    report_meta: {
      report_type: extraction.report_type,
      date: extraction.date,
      language: params.language,
      ocr_confidence: params.record.ocr_confidence,
      is_medical_document: true,
      refusal_reason: null,
    },
    findings: interpreted.findings,
    medications: interpreted.medications,
    jargon_glossary: interpreted.jargon_glossary,
    urgent_summary: triage.urgent_summary,
    overall_summary: interpreted.overall_summary,
    questions_for_doctor: questions,
    safety: {
      critic_passed: criticResult.critic_passed,
      fallback_used: fallbackUsed,
      regeneration_attempts: regenerationAttempts,
      violations: criticResult.violations,
      disclaimer: EDUCATIONAL_DISCLAIMER[params.language],
      pii_redacted_count: params.record.pii_redacted_count,
      redacted_categories: params.record.redacted_categories,
    },
  };

  emit({
    stage: 'complete',
    message: 'Analysis verified and ready.',
    progress: 100,
  });

  return {
    extraction,
    analysis,
    needsConfirmation: unconfirmedLowConf && !params.existingExtraction,
  };
}
