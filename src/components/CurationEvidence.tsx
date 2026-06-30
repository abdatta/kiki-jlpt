import type { AiCurationRecommendation, ConversationCurationEvidence } from '../../shared/types.ts';

function EvidenceWordList({ label, words }: { label: string; words: string[] }) {
  return (
    <div>
      <span>{label}</span>
      <div className="vocabChips">
        {words.length === 0 ? <span>None</span> : words.map((word) => <span key={word}>{word}</span>)}
      </div>
    </div>
  );
}

export function CurationEvidencePanel({ evidence }: { evidence?: ConversationCurationEvidence }) {
  if (!evidence) return null;
  return (
    <details className="curationEvidence">
      <summary>
        <span><b>{evidence.currentSetUniqueCount}</b> Set {evidence.setNumber}</span>
        <span><b>{evidence.allowedVocabUniqueCount}</b> allowed</span>
        <span><b>{evidence.outOfVocabularyUniqueCount}</b> OOV</span>
      </summary>
      <div className="curationEvidenceDetails">
        <EvidenceWordList label={`Set ${evidence.setNumber} unique (${evidence.currentSetUniqueCount}/${evidence.currentSetTotal})`} words={evidence.currentSetUniqueWords} />
        <EvidenceWordList label={`Allowed unique (${evidence.allowedVocabUniqueCount}/${evidence.allowedVocabTotal})`} words={evidence.allowedVocabUniqueWords} />
        <EvidenceWordList label={`Out of vocabulary (${evidence.outOfVocabularyUniqueCount} unique, ${evidence.outOfVocabularyOccurrenceCount} uses)`} words={evidence.outOfVocabularyUniqueWords} />
      </div>
    </details>
  );
}

export function AiRecommendationReason({ recommendation }: { recommendation: AiCurationRecommendation }) {
  return (
    <div className="aiRecommendationReason">
      <strong>{recommendation.rationale}</strong>
      {recommendation.strengths.length ? <p>Strengths: {recommendation.strengths.join(' · ')}</p> : null}
      {recommendation.concerns.length ? <p className="warningText">Concerns: {recommendation.concerns.join(' · ')}</p> : null}
    </div>
  );
}
