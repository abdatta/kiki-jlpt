import { useState } from 'react';
import type {
  AiCurationProjectedWord,
  AiCurationRecommendation,
  ConversationCurationEvidence
} from '../../shared/types.ts';

type FrequencyPlotMode = 'stacked' | 'before' | 'after';

function plotFrequency(word: AiCurationProjectedWord, mode: FrequencyPlotMode): number {
  return mode === 'before' ? word.currentLibraryCount : word.projectedLibraryCount;
}

function bellCurveOrder(words: AiCurationProjectedWord[], mode: FrequencyPlotMode): AiCurationProjectedWord[] {
  const byFrequency = [...words].sort((a, b) => (
    plotFrequency(a, mode) - plotFrequency(b, mode)
    || a.currentLibraryCount - b.currentLibraryCount
    || a.japanese.localeCompare(b.japanese, 'ja')
  ));
  const left: AiCurationProjectedWord[] = [];
  const right: AiCurationProjectedWord[] = [];
  byFrequency.forEach((word, index) => (index % 2 === 0 ? left : right).push(word));
  return [...left, ...right.reverse()];
}

function FrequencyPlot({
  maxFrequency,
  mode,
  words
}: {
  maxFrequency: number;
  mode: FrequencyPlotMode;
  words: AiCurationProjectedWord[];
}) {
  const orderedWords = bellCurveOrder(words, mode);

  return (
    <div className="wordFrequencyPlot">
      <div className="wordFrequencyScale" aria-hidden="true">
        <span>{maxFrequency}</span>
        <span>{Math.ceil(maxFrequency / 2)}</span>
        <span>0</span>
      </div>
      <div className="wordFrequencyBars">
        {orderedWords.map((word) => {
          const delta = Math.max(0, word.projectedLibraryCount - word.currentLibraryCount);
          const frequency = plotFrequency(word, mode);
          const barHeight = (frequency / maxFrequency) * 100;
          const currentHeight = word.projectedLibraryCount
            ? (word.currentLibraryCount / word.projectedLibraryCount) * 100
            : 0;
          const deltaHeight = word.projectedLibraryCount
            ? (delta / word.projectedLibraryCount) * 100
            : 0;
          const showDelta = mode !== 'before' && delta > 0;
          const label = `${word.japanese}: ${frequency}${showDelta ? ` (+${delta})` : ''}`;
          return (
            <div className="wordFrequencyBar" key={word.japanese} aria-label={label} role="img" style={{ height: `${barHeight}%` }}>
              <span className="wordFrequencyTooltip" role="tooltip">
                <strong>{word.japanese}</strong>
                <span>{frequency}{showDelta ? <em>+{delta}</em> : null}</span>
              </span>
              <span className="wordFrequencyStack">
                {mode === 'stacked' ? (
                  <>
                    <span className="wordFrequencyDelta" style={{ height: `${deltaHeight}%` }} />
                    <span className="wordFrequencyCurrent" style={{ height: `${currentHeight}%` }} />
                  </>
                ) : (
                  <span className={mode === 'before' ? 'wordFrequencyCurrent' : 'wordFrequencyAfter'} style={{ height: '100%' }} />
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="wordFrequencyAxis" aria-hidden="true">
        <span>Less frequent</span>
        <span>Most frequent</span>
        <span>Less frequent</span>
      </div>
    </div>
  );
}

export function WordFrequencyDistribution({ words }: { words: AiCurationProjectedWord[] }) {
  const [splitView, setSplitView] = useState(false);
  if (words.length === 0) return null;
  const maxFrequency = Math.max(1, ...words.map((word) => word.projectedLibraryCount));

  return (
    <details className="wordFrequencyDistribution">
      <summary className="wordFrequencyHeader">
        <span>Word frequency distribution</span>
        <div className="wordFrequencyLegend" aria-label="Chart legend">
          <span><i className="frequencyCurrentSwatch" />{splitView ? 'Before Add All' : 'Current'}</span>
          <span><i className="frequencyDeltaSwatch" />{splitView ? 'After Add All' : 'Added by Add All'}</span>
        </div>
      </summary>
      <div className="wordFrequencyBody">
        <div className="wordFrequencyBodyHeader">
          <p>Less frequent words sit at the edges; the most frequent are grouped in the centre.</p>
          <button
            aria-pressed={splitView}
            className="frequencyViewToggle"
            onClick={() => setSplitView((current) => !current)}
            type="button"
          >
            <span aria-hidden="true"><i /><i /></span>
            {splitView ? 'Stack bars' : 'Split view'}
          </button>
        </div>
        <div className={`wordFrequencyScroller${splitView ? ' split' : ''}`}>
          {splitView ? (
            <div className="wordFrequencySplit">
              <div className="wordFrequencyPane">
                <h4>Before Add All</h4>
                <FrequencyPlot maxFrequency={maxFrequency} mode="before" words={words} />
              </div>
              <div className="wordFrequencyPane">
                <h4>After Add All</h4>
                <FrequencyPlot maxFrequency={maxFrequency} mode="after" words={words} />
              </div>
            </div>
          ) : <FrequencyPlot maxFrequency={maxFrequency} mode="stacked" words={words} />}
        </div>
      </div>
    </details>
  );
}

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

function EvidenceDetailList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <span>{label}</span>
      <div className="vocabChips">
        {items.map((item) => <span key={item}>{item}</span>)}
      </div>
    </div>
  );
}

export function CurationEvidencePanel({ evidence }: { evidence?: ConversationCurationEvidence }) {
  if (!evidence) return null;
  const exemptions = evidence.vocabularyExemptions ?? [];
  const rejected = evidence.rejectedVocabularyDeclarations ?? [];
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
        <EvidenceWordList label={`True out of vocabulary (${evidence.outOfVocabularyUniqueCount} unique, ${evidence.outOfVocabularyOccurrenceCount} uses)`} words={evidence.outOfVocabularyUniqueWords} />
        <EvidenceDetailList
          label={`Accepted exemptions (${exemptions.length})`}
          items={exemptions.map((item) => `${item.surface} · ${item.kind}${item.category ? ` · ${item.category}` : ''}`)}
        />
        <EvidenceDetailList
          label={`Rejected declarations (${rejected.length})`}
          items={rejected.map((item) => `${item.surface} · ${item.category} · ${item.reason}`)}
        />
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
