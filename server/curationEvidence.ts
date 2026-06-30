import type { ConversationCurationEvidenceMap, PracticeConversation } from '../shared/types.ts';
import { getAllowedVocabulary } from './vocab.ts';
import { analyzeConversationsWithVocabulary } from './vocabAudit.ts';

export async function getConversationCurationEvidence(
  setNumber: number,
  conversations: PracticeConversation[]
): Promise<ConversationCurationEvidenceMap> {
  const allowedVocabulary = await getAllowedVocabulary(setNumber);
  return (await analyzeConversationsWithVocabulary(setNumber, allowedVocabulary, conversations)).evidenceByConversationId;
}
