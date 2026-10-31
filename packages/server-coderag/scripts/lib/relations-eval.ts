import type { RelationHit, VectorDB } from '../../src/vectordb/db.ts';
import type { RelationQuestion, RelationQuestionKind } from './relations-queries.ts';

/** The last two path segments, `tools/delete-document.ts`. */
function last2(file: string): string {
  return file.replaceAll('\\', '/').split('/').slice(-2).join('/');
}

/** Hits at or above this confidence are resolved or ambiguous names; below it the callee is not an indexed symbol. */
const KNOWN_CALLEE = 0.5;

function itemsOf(kind: RelationQuestionKind, hits: readonly RelationHit[]): string[] {
  switch (kind) {
    case 'callers':
    case 'inheritors':
      return hits.map((h) => `${last2(h.source.file)}:${h.source.name}`);
    case 'callees':
      return hits.filter((h) => h.confidence >= KNOWN_CALLEE).map((h) => h.target?.name ?? h.targetName);
    case 'imports':
      return hits.map((h) => h.targetName);
    case 'importers':
      return hits.map((h) => last2(h.source.file));
  }
}

function queryFor(kind: RelationQuestionKind): { direction: 'in' | 'out'; types: ('calls' | 'imports' | 'inherits')[] } {
  switch (kind) {
    case 'callers': return { direction: 'in', types: ['calls'] };
    case 'callees': return { direction: 'out', types: ['calls'] };
    case 'imports': return { direction: 'out', types: ['imports'] };
    case 'importers': return { direction: 'in', types: ['imports'] };
    case 'inheritors': return { direction: 'in', types: ['inherits'] };
  }
}

export interface QuestionOutcome {
  question: string;
  kind: RelationQuestionKind;
  expected: number;
  returned: number;
  correct: number;
  missed: string[];
  extra: string[];
}

export interface RelationEvalGroup {
  questions: number;
  /** Correct items over returned items, and over expected items, summed over the questions of the group. */
  precision: number;
  recall: number;
}

export interface RelationEvalSummary {
  outcomes: QuestionOutcome[];
  calls: RelationEvalGroup;
  imports: RelationEvalGroup;
  inherits: RelationEvalGroup;
}

const GROUPS: Record<'calls' | 'imports' | 'inherits', readonly RelationQuestionKind[]> = {
  calls: ['callers', 'callees'],
  imports: ['imports', 'importers'],
  inherits: ['inheritors'],
};

function aggregate(outcomes: readonly QuestionOutcome[], kinds: readonly RelationQuestionKind[]): RelationEvalGroup {
  const rows = outcomes.filter((o) => kinds.includes(o.kind));
  const sum = (pick: (o: QuestionOutcome) => number): number => rows.reduce((total, o) => total + pick(o), 0);
  return {
    questions: rows.length,
    precision: sum((o) => o.correct) / Math.max(1, sum((o) => o.returned)),
    recall: sum((o) => o.correct) / Math.max(1, sum((o) => o.expected)),
  };
}

export function evaluateRelations(db: VectorDB, questions: readonly RelationQuestion[]): RelationEvalSummary {
  const outcomes = questions.map((q): QuestionOutcome => {
    const { direction, types } = queryFor(q.kind);
    const page = db.queryRelations({ symbol: q.symbol, direction, types, limit: 1000, offset: 0 });
    const returned = [...new Set(itemsOf(q.kind, page.hits))];
    const expected = new Set(q.expect);
    return {
      question: q.question,
      kind: q.kind,
      expected: expected.size,
      returned: returned.length,
      correct: returned.filter((item) => expected.has(item)).length,
      missed: [...expected].filter((item) => !returned.includes(item)),
      extra: returned.filter((item) => !expected.has(item)),
    };
  });
  return { outcomes, calls: aggregate(outcomes, GROUPS.calls), imports: aggregate(outcomes, GROUPS.imports), inherits: aggregate(outcomes, GROUPS.inherits) };
}

export function formatRelationSummary(summary: RelationEvalSummary): string {
  const pct = (n: number): string => n.toFixed(3);
  const lines = summary.outcomes.map(
    (o) => `${o.kind.padEnd(10)} ${o.question.slice(0, 52).padEnd(52)} expected=${String(o.expected).padStart(2)} returned=${String(o.returned).padStart(2)} correct=${String(o.correct).padStart(2)}${o.missed.length > 0 ? ` MISSED ${o.missed.join(', ')}` : ''}${o.extra.length > 0 ? ` EXTRA ${o.extra.join(', ')}` : ''}`,
  );
  for (const name of ['calls', 'imports', 'inherits'] as const) {
    const g = summary[name];
    lines.push(`SUMMARY ${name.padEnd(8)} questions=${String(g.questions)} precision=${pct(g.precision)} recall=${pct(g.recall)}`);
  }
  return lines.join('\n');
}
