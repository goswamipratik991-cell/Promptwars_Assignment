# MediMind Prompt Registry & Safety Design Rationale

This document tracks every versioned prompt in `backend/prompts/prompts.ts`, why each rule exists, conservative ambiguity decisions, and failure cases mitigated during testing.

---

## 1. Extraction Prompt (`extraction: v1.2.0`)

- **Role:** `"You are a medical document data extractor. You do not interpret, diagnose, or triage."`
- **Why separated from interpretation:** Coupling extraction and explanation in a single prompt increases the risk of the LLM silently "normalizing" typos or inventing reference ranges when they are missing.
- **Prompt-Injection Defense:** Document contents are wrapped inside `<DOCUMENT_DATA_UNTRUSTED>...</DOCUMENT_DATA_UNTRUSTED>` with explicit instructions to treat all enclosed text strictly as passive data.
- **Few-Shot Coverage:** Includes 3 concrete examples:
  1. Standard CBC panel.
  2. Lipid panel with a missing reference range (`Triglycerides` → `reference_range: null`).
  3. Outpatient prescription with clinical abbreviations (`BD PC`, `OD HS`, `TDS SOS`).
- **Ambiguity Decision (Conservative):** If a unit or reference range is missing or smudged, the extractor must output `null` and flag `ocr_confidence: "low"` rather than inferring from memory.

---

## 2. Interpretation Prompt (`interpretation: v1.3.0`)

- **Ground-Truth Lock:** Receives the deterministic `status` and `status_reason` computed by `backend/services/triage.ts`. Explicitly forbidden from changing or contradicting any status.
- **Required Non-Diagnostic Patterns:** Instructed to use phrases like `"can be associated with"`, `"your doctor may want to look at"`, and `"this report alone cannot tell"`.
- **Banned Phrases (Regex-Enforced):** `"you have"`, `"you are suffering from"`, `"this means you"`, `"diagnosis is"`, `"stop taking"`, `"increase your dose"`, `"decrease your dose"`, `"you will"`, `"nothing to worry about"`, `"definitely"`.
- **Multilingual Safety (`en`, `hi`, `bn`):** Translates prose explanations into simple Hindi or Bengali while enforcing that **all lab measurements, units, and medication names stay verbatim in Latin/numeric form** to prevent translation distortion of clinical numbers.

---

## 3. Safety Critic Prompt (`critic: v1.1.0`)

- **Three-Layer Verification:**
  1. **Deterministic Regex Scanner:** Catches any banned diagnostic, dosing, or false-reassurance phrase immediately.
  2. **Numeric Grounding Check:** Extracts numbers from generated prose and verifies every decimal or value $> 10$ exists in the source extraction or safe structural/emergency phone numbers (`112`, `108`, `911`, `999`).
  3. **Independent LLM Critic:** Reviews the candidate output against the original extraction to catch subtle implied diagnoses or status downplaying.
- **Failure Recovery:** On failure, feeds exact violating spans back to the interpreter once (`regeneration_attempts = 1`). If a second failure occurs, automatically switches to `buildConservativeFallbackInterpretation()`, a 100% deterministic template guaranteed to pass all safety checks.

---

## 4. Doctor-Visit Question Generator (`questions: v1.1.0`)

- **Priority Ordering:** Urgent findings are always placed at Priority 1.
- **Six Required Dimensions:** Understanding results, everyday/medication causes to rule out, follow-up tests, repeat timeline, safe lifestyle monitoring, and medication safety (side effects / missed-dose guidance).

---

## 5. Failure Cases Found & Fixed

| Failure Pattern | Root Cause | Fix Implemented |
|---|---|---|
| Missing unit critical false negative (e.g. `Glucose 27.5 mmol/L`) | Critical table stored `mg/dL` thresholds only. | Added deterministic unit conversion map in `critical_values.json` (`mmol/L × 18.0182 → mg/dL`, `g/L × 0.1 → g/dL`) and refused unknown units instead of guessing. |
| False critical alert on unknown unit (`6.5 bananas/L`) | Naive numeric match without unit validation. | `convertToCanonicalUnit()` flags `unitMismatch: true` and assigns `UNCLASSIFIED_NO_RANGE`. |
| Phone number regex over-redacting 5-digit lab counts (`Platelets 150000`) | Broad digit pattern matched lab numbers. | Restricted PII phone matcher to labeled phone fields (`Phone:`, `Mob:`, `Tel:`) or explicit international `+country` prefixes. |
| Prompt injection inside lab notes (`"IGNORE PREVIOUS INSTRUCTIONS..."`) | Unbounded document text in single prompt. | XML sandboxing + deterministic code-first triage + regex & LLM Safety Critic pass. |
