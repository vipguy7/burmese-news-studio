// Strip markdown + structural labels so narrative output is broadcast-ready.
const LABEL_PATTERNS = [
  /^\s*(intro|introduction|lead|lede|body|conclusion|outro|opening|closing|hook|nut graf|nutgraf|kicker|headline|title|summary|tldr|tl;dr|cta|call to action|narration|voiceover|vo|sot|b-roll|broll|anchor|reporter|host)\s*[:\-—]\s*/gim,
  /^\s*(အနိဒါန်း|နိဒါန်း|အကြောင်းအရာ|နိဂုံး|နိဂုံးချုပ်|အကျဉ်းချုပ်|ခေါင်းစဉ်)\s*[:\-—]\s*/gim,
  /^\s*(part|section|paragraph|step|chapter|scene|act)\s+\d+\s*[:\-—]?\s*/gim,
];

export function cleanNarrative(input: string): string {
  if (!input) return "";
  let out = input;

  // Remove code fences
  out = out.replace(/```[\s\S]*?```/g, (m) => m.replace(/```[\w-]*\n?|```/g, ""));
  // Strip markdown headings
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  // Strip bold/italic/strike markers but keep inner text
  out = out.replace(/(\*\*\*|\*\*|\*|__|_|~~)(.*?)\1/g, "$2");
  // Remove stray asterisks/hashes/backticks
  out = out.replace(/[*`#]+/g, "");
  // Bullet/numbered list markers -> plain lines
  out = out.replace(/^\s*[-•·]\s+/gm, "");
  out = out.replace(/^\s*\d+[.)]\s+/gm, "");
  // Blockquote markers
  out = out.replace(/^\s*>+\s?/gm, "");
  // Structural labels
  for (const re of LABEL_PATTERNS) out = out.replace(re, "");
  // Collapse 3+ newlines
  out = out.replace(/\n{3,}/g, "\n\n");
  // Trim trailing spaces per line
  out = out.replace(/[ \t]+$/gm, "");
  return out.trim();
}
