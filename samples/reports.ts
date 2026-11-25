export interface SampleReport {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  report_type: 'lab' | 'prescription';
  text: string;
}

export const SAMPLE_REPORTS: SampleReport[] = [
  {
    id: 'sample-normal-cbc',
    title: 'Normal Complete Blood Count',
    subtitle: 'Routine preventive panel · All values within reference ranges',
    badge: 'Normal Pattern',
    report_type: 'lab',
    text: `NCPL DIAGNOSTICS & CLINICAL LABS
Report Date: 12-Nov-2026
Patient Name: Aarav Sharma | Age/Sex: 34Y / M | MRN: NCPL-884210
Phone: +91 98201 44510

COMPLETE BLOOD COUNT (CBC) - EDTA WHOLE BLOOD
Haemoglobin: 14.2 g/dL (13.0 - 17.0)
Total Leukocyte Count (WBC): 6.8 x10^9/L (4.0 - 11.0)
Red Blood Cell (RBC) Count: 4.9 million/uL (4.5 - 5.9)
Haematocrit (PCV): 42.5 % (40.0 - 50.0)
MCV: 86.7 fL (80.0 - 100.0)
Platelet Count: 248 x10^9/L (150 - 400)

Verified by Pathologist.`
  },
  {
    id: 'sample-anaemia-pattern',
    title: 'Low Haemoglobin & Ferritin Panel',
    subtitle: 'Fatigue workup · Significant low haemoglobin and low iron stores',
    badge: 'Abnormal Pattern',
    report_type: 'lab',
    text: `METRO HEALTH LAB SERVICES
Report Date: 18-Nov-2026
Patient: Priya Nair | DOB: 14/05/1991 | Mobile: 9811223344

HEMATOLOGY & IRON STUDIES
Haemoglobin: 8.9 g/dL (12.0 - 15.5)
MCV: 71.4 fL (80.0 - 98.0)
MCH: 22.8 pg (27.0 - 32.0)
Platelet Count: 390 x10^9/L (150 - 400)
Serum Ferritin: 6.5 ng/mL (15.0 - 150.0)
WBC Count: 7.2 x10^9/L (4.0 - 11.0)`
  },
  {
    id: 'sample-glucose-hba1c',
    title: 'Elevated Glucose, HbA1c & Lipids',
    subtitle: 'Metabolic follow-up · Includes a test without a printed range',
    badge: 'Mixed + Missing Range',
    report_type: 'lab',
    text: `CITY CENTRAL PATHOLOGY
Date: 20-Nov-2026
Patient Name: Ramesh Kulkarni | Address: 42 MG Road, Pune

METABOLIC & LIPID PROFILE
Fasting Blood Glucose: 168 mg/dL (70 - 100)
HbA1c (Glycated Haemoglobin): 8.1 % (4.0 - 5.6)
Total Cholesterol: 228 mg/dL (<200)
Triglycerides: 194 mg/dL
HDL Cholesterol: 42 mg/dL (>40)
Serum Creatinine: 1.0 mg/dL (0.7 - 1.3)`
  },
  {
    id: 'sample-critical-potassium',
    title: 'Critical Potassium & Renal Alert',
    subtitle: 'Emergency lab alert · Triggers urgent clinical escalation view',
    badge: 'Potentially Urgent',
    report_type: 'lab',
    text: `APEX EMERGENCY LABORATORY
Report Date: 25-Nov-2026
Patient: Meera Deshmukh | ID: MRN-449012

STAT ELECTROLYTES & RENAL PANEL
ALERT: CRITICAL VALUE - CALL PHYSICIAN IMMEDIATELY
Serum Potassium (K+): 6.5 mmol/L (3.5 - 5.1)
Serum Sodium (Na+): 131 mmol/L (135 - 145)
Serum Creatinine: 3.4 mg/dL (0.6 - 1.2)
Haemoglobin: 10.6 g/dL (12.0 - 15.5)
WBC Count: 8.9 x10^9/L (4.0 - 11.0)`
  },
  {
    id: 'sample-prescription',
    title: 'Outpatient Prescription (Rx)',
    subtitle: 'Medication abbreviations · BD, TDS, OD, HS, SOS decoder demo',
    badge: 'Prescription',
    report_type: 'prescription',
    text: `CLINIC OUTPATIENT PRESCRIPTION
Date: 22-Nov-2026
Patient: Suresh Verma | Ph: 9900112233

Rx
1. Tab Metformin 500 mg PO BD PC x 30 days
2. Tab Amlodipine 5 mg PO OD x 30 days
3. Tab Atorvastatin 10 mg PO OD HS x 30 days
4. Tab Paracetamol 650 mg PO TDS SOS for fever or body ache
5. Cap Pantoprazole 40 mg PO OD AC (30 mins before breakfast)

Follow up in 4 weeks with fasting glucose log.`
  }
];
