// On-device PII redaction preview (mirrors server-side redact.ts so PII can be stripped before leaving browser)
export interface ClientRedactionPreview {
  redactedText: string;
  redactedCount: number;
  categories: string[];
}

export function previewClientRedaction(input: string): ClientRedactionPreview {
  let text = input;
  let redactedCount = 0;
  const categories = new Set<string>();

  const apply = (regex: RegExp, replacement: string, category: string) => {
    text = text.replace(regex, () => {
      redactedCount += 1;
      categories.add(category);
      return replacement;
    });
  };

  apply(
    /(?:Patient\s*Name|Patient|Pt\.?\s*Name|Name)\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{1,50}?)(?=\s*(?:\||,|\n|Age|DOB|Sex|Gender|MRN|ID|Ph|Phone|Mobile|$))/gi,
    'Patient: [REDACTED_NAME]',
    'Patient Name',
  );
  apply(
    /(?:DOB|Date\s*of\s*Birth|Birth\s*Date)\s*[:\-]\s*[0-9]{1,4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}/gi,
    'DOB: [REDACTED_DOB]',
    'Date of Birth',
  );
  apply(
    /(?:Phone|Ph|Tel|Mobile|Mob|Contact)\s*[:\-]?\s*(?:\+?\d[\d\s\-()]{7,16}\d)/gi,
    'Phone: [REDACTED_PHONE]',
    'Phone Number',
  );
  apply(
    /\+\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,6}/g,
    '[REDACTED_PHONE]',
    'Phone Number',
  );
  apply(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    '[REDACTED_EMAIL]',
    'Email Address',
  );
  apply(
    /(?:MRN|UHID|Patient\s*ID|Reg(?:istration)?\s*(?:No|ID)|Hospital\s*ID)\s*[:\-#]?\s*[A-Za-z0-9\-]{4,20}/gi,
    'MRN: [REDACTED_ID]',
    'Medical Record Number',
  );
  apply(
    /(?:Address|Addr|Residence)\s*[:\-]\s*[^\n]{6,100}/gi,
    'Address: [REDACTED_ADDRESS]',
    'Street Address',
  );

  return {
    redactedText: text,
    redactedCount,
    categories: Array.from(categories),
  };
}

// Ephemeral in-memory session token (never stored in localStorage/sessionStorage)
let inMemorySessionToken: string | null = null;

export function getSessionToken(): string {
  if (!inMemorySessionToken) {
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    inMemorySessionToken = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return inMemorySessionToken;
}

export function resetSessionToken(): void {
  inMemorySessionToken = null;
}
