export const CURATION_EVIDENCE_VERSION = '5';

export const ALLOWED_PARTICLES = [
  'は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'の', 'か', 'ね', 'よ', 'から', 'まで', 'より', 'だけ'
] as const;

export const ALLOWED_POLITE_FORMS = [
  'です', 'でした', 'ではありません', 'じゃありません', 'ます', 'ません', 'ました', 'ませんでした'
] as const;

export const ALLOWED_BASIC_GRAMMAR = [
  'て-form', 'ください', 'ましょう', 'たいです', 'から', 'そして', 'でも', 'もう', 'まだ'
] as const;

export const ALLOWED_CONVERSATION_FILLERS = [
  'はい', 'いいえ', 'ええ', 'うん', 'あの', 'ええと', 'そう', 'そうですね', 'では', 'じゃあ'
] as const;

export const APPROVED_FEMALE_NAMES = [
  'さくら', 'はな', 'ゆき', 'あい', 'みき', 'なお', 'えみ', 'けいこ'
] as const;

export const APPROVED_MALE_NAMES = [
  'たろう', 'けん', 'けんた', 'しょう', 'なおき', '太郎', '健', '健太', '翔', '直樹'
] as const;

export const APPROVED_GENERATED_NAMES = [
  ...APPROVED_FEMALE_NAMES,
  ...APPROVED_MALE_NAMES
] as const;

const AUDIT_EXEMPT_FORMS = new Set([
  ...ALLOWED_PARTICLES,
  ...ALLOWED_POLITE_FORMS,
  ...ALLOWED_BASIC_GRAMMAR.filter((form) => form !== 'て-form'),
  ...ALLOWED_CONVERSATION_FILLERS,
  ...APPROVED_GENERATED_NAMES,
  // Kuromoji basic forms for prompt-permitted inflections.
  'くださる', '下さる', 'だ', 'ある', 'いる'
]);

export function isAuditExemptForm(forms: Iterable<string>): boolean {
  for (const form of forms) {
    if (AUDIT_EXEMPT_FORMS.has(form)) return true;
  }
  return false;
}

export function formatLanguagePolicyForPrompt(): string {
  return `Allowed grammar/function whitelist:

Particles:
${ALLOWED_PARTICLES.join(', ')}

Polite forms:
${ALLOWED_POLITE_FORMS.join(', ')}

Basic grammar:
${ALLOWED_BASIC_GRAMMAR.join(', ')}

Conversation fillers:
${ALLOWED_CONVERSATION_FILLERS.join(', ')}

Approved common names:
- Speaker 1 female names: ${APPROVED_FEMALE_NAMES.join(', ')}
- Speaker 2 male names: ${APPROVED_MALE_NAMES.join(', ')}

Question words:
Question words are allowed only if they are in the allowed vocabulary table.

Conjugations:
Conjugations of learned verbs/adjectives are allowed and do not count as new words.`;
}
