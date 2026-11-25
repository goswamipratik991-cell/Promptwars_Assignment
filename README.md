# MediMind — Intelligent Medical Report Interpreter

**PromptWars Competition · Theme: Emergency Response Optimization Platform – NCPL Meditech**

MediMind translates complex laboratory reports, scanned medical documents, and outpatient prescriptions into calm, Grade 6–8 plain-language explanations while surfacing **potentially urgent** findings immediately — **without ever inventing a diagnosis**.

---

## Pitch: Problem, Solution & Safety Architecture

- **Problem:** Patients receive dense lab panels and abbreviated prescriptions (`BD`, `TDS`, `HS`, `SOS`) with no clear distinction between harmless variations, findings to discuss at a routine visit, and critical thresholds that require urgent care today. Generic chatbots frequently hallucinate diagnoses or miss critical unit conversions.
- **Solution:** MediMind separates **clinical classification** from **language generation**. Deterministic code classifies every analyte first against the report's printed reference range and a curated critical-value table (`backend/data/critical_values.json`), while the LLM only explains those grounded classifications in plain English, Hindi, or Bengali.
- **Why Deterministic Triage + Safety Critic Prevents Invented Diagnoses:**
  1. The LLM never decides whether a value is `NORMAL`, `ABNORMAL_MILD`, `ABNORMAL_SIGNIFICANT`, or `POTENTIALLY_URGENT`.
  2. Every explanation passes through an independent **3-layer Safety Critic** (banned-phrase regex scanner, numeric grounding check verifying numbers exist in the source report, and an independent LLM safety critic) with one repair retry and a deterministic conservative template fallback.
- **Roadmap:**
  - **EHR / FHIR R4 Import:** Direct `DiagnosticReport` and `Observation` JSON ingestion from hospital portals.
  - **Wearable Telemetry Fusion:** Correlate resting HR, SpO2, and continuous glucose monitors with lab trends.
  - **Clinician Triage View:** Hospital-side emergency queue prioritization for NCPL Meditech response teams.

---

## Multi-Stage Architecture

```
Upload (PDF / JPG / PNG / Paste Text)
   │
   ├─► [0] On-Device & Server PII Redaction (Name, DOB, Phone, Email, MRN, Address)
   ├─► [1] Ingest & OCR (pdf-parse for text PDFs · Gemini Vision OCR fallback for scans/photos)
   ├─► [2] Structured Extraction (LLM · verbatim quotes, null for missing ranges, prompt-injection sandbox)
   ├─► [3] Deterministic Triage (Code-First · critical_values.json + unit conversions + 20% range rubric)
   ├─► [4] Plain-Language Interpretation (EN / HI / BN · grounded strictly in [2] + [3])
   ├─► [5] Safety Critic (Regex + Numeric Grounding + LLM Critic · 1 retry -> deterministic fallback)
   ├─► [6] Doctor-Visit Question Generator (Prioritized checklist tied to finding IDs)
   └─► [7] Clinical Dashboard + Focused Emergency Mode + 24h QR Doctor Share + Printable ER Handover
```

---

## Classification Rubric

| Status | Deterministic Rule |
|---|---|
| `POTENTIALLY_URGENT` | Matches `backend/data/critical_values.json` (with explicit `mg/dL ↔ mmol/L` & `g/dL ↔ g/L` conversion) OR report text contains `"CRITICAL"`, `"PANIC VALUE"`, `"URGENT"`, `"CALL PHYSICIAN IMMEDIATELY"`. |
| `NORMAL` | Numeric value falls within the printed reference range (or qualitative `"Negative"` / `"Non-Reactive"`). |
| `ABNORMAL_MILD` | Outside printed range by $\le 20\%$ of the range width. |
| `ABNORMAL_SIGNIFICANT` | Outside printed range by $> 20\%$ of the range width. |
| `UNCLASSIFIED_NO_RANGE` | No usable printed range and not in critical table (or unit mismatch — never guesses). |
| `UNREADABLE` | Low OCR confidence ($< 0.55$) or unparseable value; prompts user confirmation via `POST /api/reports/:id/confirm-values`. |

---

## Evaluation Scorecard (28 Synthetic Cases)

Run locally via `npm run eval` or view live in the **Evals** tab:

| Metric | Target | Measured Result |
|---|---|---|
| Cases Passed | 100% | **28 / 28** |
| Deterministic Status Accuracy | $\ge 98\%$ | **100.0%** |
| Urgent Critical-Value Recall | 100% | **100.0%** |
| Zero-Diagnosis Violations | 0 | **0** |
| Numeric Hallucination Violations | 0 | **0** |
| Prompt-Injection Defense | 100% | **100.0%** |
| Avg Readability (Flesch-Kincaid Grade) | $\le 8.0$ | **7.1** |

---

## Setup & Running Locally

```bash
npm install
cp .env.example .env   # Configure GEMINI_API_KEY
npm run dev            # Starts Express + Vite on http://localhost:3000
npm test               # Runs Vitest unit & safety suite
npm run eval           # Runs 28-case clinical safety & triage eval harness
```

---

## 2-Minute Demo Script (NCPL Meditech Pitch)

1. **Privacy First (0:00–0:20):** Paste the **Low Haemoglobin & Ferritin Panel** sample. Point out the live **On-Device Privacy Shield** stripping patient name, DOB, and mobile number before any API call leaves the browser.
2. **Transparent Triage & Range Bars (0:20–0:55):** Click **Run Analysis**. Watch the 6-stage SSE progress bar. On the dashboard, inspect the Recharts Range Bar for Haemoglobin (`8.9 g/dL`), expand **Why Flagged** to show the Transparency Ledger (`source_quote` + exact rule `OUTSIDE_RANGE_GT_20_PCT_LOW`), and toggle **हिन्दी / বাংলা** to show localized explanations with unchanged clinical numbers.
3. **Emergency Response Optimization (0:55–1:30):** Load **Critical Potassium & Renal Alert** (`K+ 6.5 mmol/L`). MediMind immediately activates **Focused Emergency Mode**, displays region-aware `112 / 108` call actions, and generates a 1-page printable **"Hand to ER Doctor"** handover sheet.
4. **Prescription Decoder & Visit Prep (1:30–2:00):** Load **Outpatient Prescription (Rx)** to decode `BD PC`, `OD HS`, and `TDS SOS`, customize the **Questions for Your Doctor** checklist, and generate a 24-hour expiring **QR Code Share Link**.

---

## Known Limitations

- Reference ranges can vary by age, sex, pregnancy status, and laboratory assay; MediMind always defers to the range printed on the patient's own report and never invents missing ranges.
- Handwritten prescriptions with severe illegibility may require manual user confirmation before analysis.
- MediMind provides educational explanations only and is not a medical device or diagnostic tool.
