export interface RedactionResult {
  redactedText: string;
  redactedCount: number;
  categories: string[];
}

const REDACTION_RULES: Array<{ category: string; regex: RegExp; replacement: string }> = [
  {
    category: 'Patient Name',
    regex: /(?:Patient\s*Name|Patient|Pt\.?\s*Name|Name)\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{1,50}?)(?=\s*(?:\||,|\n|Age|DOB|Sex|Gender|MRN|ID|Ph|Phone|Mobile|$))/gi,
    replacement: 'Patient: [REDACTED_NAME]',
  },
  {
    category: 'Date of Birth',
    regex: /(?:DOB|Date\s*of\s*Birth|Birth\s*Date)\s*[:\-]\s*[0-9]{1,4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}/gi,
    replacement: 'DOB: [REDACTED_DOB]',
  },
  {
    category: 'Phone Number',
    regex: /(?:(?:Phone|Ph|Tel|Mobile|Mob|Contact)\s*[:\-]?\s*)?(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)?\d{5,10}/gi,
    replacement: '[REDACTED_PHONE]',
  },
  {
    category: 'Email Address',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    category: 'Medical Record Number (MRN)',
    regex: /(?:MRN|UHID|Patient\s*ID|Reg(?:istration)?\s*(?:No|ID)|Hospital\s*ID)\s*[:\-#]?\s*[A-Za-z0-9\-]{4,20}/gi,
    replacement: 'MRN: [REDACTED_ID]',
  },
  {
    category: 'Street Address',
    regex: /(?:Address|Addr|Residence)\s*[:\-]\s*[^\n]{6,100}/gi,
    replacement: 'Address: [REDACTED_ADDRESS]',
  },
];

export function redactPII(input: string): RedactionResult {
  let text = input;
  let redactedCount = 0;
  const categories = new Set<string>();

  for (const rule of REDACTION_RULES) {
    if (rule.category === 'Phone Number') {
      // Avoid redacting lab reference ranges or 4-digit lab numbers unless 10+ digits or explicitly labeled phone
      const phoneLabelRegex = /(?:Phone|Ph|Tel|Mobile|Mob|Contact)\s*[:\-]?\s*(?:\+?\d[\d\s\-()]{7,16}\d)/gi;
      const intlPhoneRegex = /\+\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,6}/g;
      text = text.replace(phoneLabelRegex, () => {
        redactedCount += 1;
        categories.add(rule.category);
        return 'Phone: [REDACTED_PHONE]';
      });
      text = text.replace(intlPhoneRegex, () => {
        redactedCount += 1;
        categories.add(rule.category);
        return '[REDACTED_PHONE]';
      });
      continue;
    }

    text = text.replace(rule.regex, () => {
      redactedCount += 1;
      categories.add(rule.category);
      return rule.replacement;
    });
  }

  return {
    redactedText: text,
    redactedCount,
    categories: Array.from(categories),
  };
}
