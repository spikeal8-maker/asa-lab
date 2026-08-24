import { describe, expect, it } from 'vitest';
import {
  CLASSIFICATIONS,
  buildDeterministicReport,
  classifyUnit,
  normalizeUnit,
  parseArgs,
  renderMarkdown,
} from '../../tools/learning-migration-dry-run.mjs';

const id = (value: string) => `00000000-0000-4000-8000-${value.padStart(12, '0')}`;

function base(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: id('1'),
    school_id: id('2'),
    classroom_id: id('3'),
    classroom_status: 'active',
    assignment_id: id('4'),
    assignment_status: 'open',
    direct_source_id: id('5'),
    course_run_id: null,
    quiz_version_id: null,
    seat_id: id('6'),
    seat_tenant_id: id('1'),
    seat_classroom_id: id('3'),
    account_id: id('7'),
    seat_status: 'active',
    legacy_project_id: null,
    legacy_started_at: null,
    legacy_submitted_at: null,
    mapped_activity_version_id: id('8'),
    attempt_id: id('9'),
    attempt_activity_version_id: id('8'),
    attempt_number: 1,
    attempt_state: 'in_progress',
    attempt_submitted_at: null,
    submission_id: null,
    submission_project_id: null,
    project_version_id: null,
    submission_kind: null,
    version_project_id: null,
    attempt_count: 1,
    submission_count: 0,
    result_count: 0,
    latest_result_id: null,
    gradebook_entry_id: null,
    accepted_attempt_id: null,
    selected_result_id: null,
    selected_result_attempt_id: null,
    selected_attempt_assignment_id: null,
    selected_attempt_seat_id: null,
    ...overrides,
  };
}

function exactProject(overrides: Record<string, unknown> = {}) {
  return base({
    legacy_project_id: id('10'),
    legacy_started_at: '2026-01-01T00:00:00Z',
    legacy_submitted_at: '2026-01-02T00:00:00Z',
    attempt_state: 'submitted',
    attempt_submitted_at: '2026-01-02T00:00:00Z',
    submission_id: id('11'),
    submission_project_id: id('10'),
    project_version_id: id('12'),
    version_project_id: id('10'),
    submission_kind: 'project',
    submission_count: 1,
    ...overrides,
  });
}

const fixtures = [
  ['clean project chain', base(), 'clean_canonical'],
  [
    'legacy submitted without Attempt',
    base({
      attempt_id: null,
      mapped_activity_version_id: null,
      attempt_activity_version_id: null,
      attempt_count: 0,
      legacy_project_id: id('10'),
      legacy_started_at: '2026-01-01Z',
      legacy_submitted_at: '2026-01-02Z',
    }),
    'legacy_unresolved',
  ],
  [
    'legacy started without Attempt',
    base({
      attempt_id: null,
      mapped_activity_version_id: null,
      attempt_activity_version_id: null,
      attempt_count: 0,
      legacy_started_at: '2026-01-01Z',
    }),
    'auto_reconcilable',
  ],
  [
    'changes requested with cleared legacy timestamp',
    exactProject({ legacy_submitted_at: null, attempt_state: 'changes_requested' }),
    'clean_canonical',
  ],
  [
    'Result without Gradebook pointer',
    exactProject({ result_count: 1, latest_result_id: id('13') }),
    'selection_conflict',
  ],
  [
    'valid old pointer plus newer attempt',
    base({
      attempt_count: 2,
      result_count: 1,
      latest_result_id: null,
      gradebook_entry_id: id('14'),
      accepted_attempt_id: id('15'),
      selected_result_id: id('16'),
      selected_result_attempt_id: id('15'),
      selected_attempt_assignment_id: id('4'),
      selected_attempt_seat_id: id('6'),
    }),
    'clean_canonical',
  ],
  [
    'cross-scope pointer',
    base({
      result_count: 1,
      gradebook_entry_id: id('14'),
      accepted_attempt_id: id('15'),
      selected_result_id: id('16'),
      selected_result_attempt_id: id('15'),
      selected_attempt_assignment_id: id('99'),
      selected_attempt_seat_id: id('6'),
    }),
    'selection_conflict',
  ],
  [
    'accepted direct quiz',
    base({
      direct_source_id: null,
      quiz_version_id: id('20'),
      attempt_state: 'accepted',
      submission_id: id('21'),
      submission_kind: 'quiz',
      submission_count: 1,
    }),
    'clean_canonical',
  ],
  [
    'course-generated project',
    exactProject({ direct_source_id: null, course_run_id: id('22') }),
    'auto_reconcilable',
  ],
  ['suspended seat history', base({ seat_status: 'suspended' }), 'visibility_only'],
  ['removed seat history', base({ seat_status: 'removed' }), 'visibility_only'],
  ['same account another class same school', base(), 'clean_canonical'],
  [
    'same account second school remains a split seed',
    base({ school_id: id('23') }),
    'clean_canonical',
  ],
  ['email-free seat seed', base({ account_id: null }), 'clean_canonical'],
  ['ambiguous identity', base({ identity_ambiguous: true }), 'identity_unresolved'],
  ['exact legacy project submission', exactProject(), 'auto_reconcilable'],
] as const;

describe('LRN-M0-005 pure migration classifier', () => {
  it.each(fixtures)('%s', (_name, row, expected) => {
    expect(classifyUnit(normalizeUnit(row))).toBe(expected);
  });

  it('uses exactly the accepted six primary values in priority order', () => {
    expect(CLASSIFICATIONS).toEqual([
      'identity_unresolved',
      'legacy_unresolved',
      'selection_conflict',
      'visibility_only',
      'auto_reconcilable',
      'clean_canonical',
    ]);
    const allConflicts = exactProject({
      identity_ambiguous: true,
      result_count: 1,
      seat_status: 'removed',
    });
    expect(classifyUnit(normalizeUnit(allConflicts))).toBe('identity_unresolved');
  });

  it('produces byte-identical deterministic output for the same rows', () => {
    const rows = fixtures.map(([, row]) => row).reverse();
    const first = JSON.stringify(buildDeterministicReport(rows));
    const second = JSON.stringify(buildDeterministicReport([...rows]));
    expect(second).toBe(first);
  });

  it('preserves all feedback tags as metadata without grade conversion', () => {
    const report = buildDeterministicReport(
      [base()],
      [
        { badge: 'excellent', count: 1 },
        { badge: 'good', count: 2 },
        { badge: 'progress', count: 3 },
        { badge: 'redo', count: 4 },
      ],
    );
    expect(report.feedback).toMatchObject({ metadataOnly: true, gradeConversions: 0, total: 10 });
    expect(Object.keys(report.feedback.byBadge)).toEqual([
      'excellent',
      'good',
      'progress',
      'redo',
      'none',
    ]);
  });

  it('redacts markdown to aggregates', () => {
    const deterministic = buildDeterministicReport([base()]);
    const markdown = renderMarkdown({
      schema: 'asa-learning-migration-dry-run/v1',
      metadata: {
        environmentKind: 'test',
        asOf: '2026-01-01T00:00:00.000Z',
        migrationVersion: '0085',
        performance: { queryCount: 5, scannedUnits: 1, elapsedMs: 1 },
      },
      deterministic,
    });
    expect(markdown).not.toContain(id('6'));
    expect(markdown).toContain('Grade conversions: 0');
  });

  it('fails closed for missing environment/output and unauthorized production', () => {
    expect(() => parseArgs([])).toThrow('environment_required');
    expect(() => parseArgs(['--environment', 'test'])).toThrow('output_paths_required');
    expect(() =>
      parseArgs(['--environment', 'production', '--output', 'a', '--markdown', 'b']),
    ).toThrow('production_not_authorized');
  });

  it('classifies 30 x 100 units deterministically within a bounded pure pass', () => {
    const rows = Array.from({ length: 3000 }, (_, index) =>
      base({
        assignment_id: id(String(1000 + Math.floor(index / 30))),
        seat_id: id(String(5000 + (index % 30))),
      }),
    );
    const started = performance.now();
    const report = buildDeterministicReport(rows);
    expect(report.totals.learningUnits).toBe(3000);
    expect(report.totals.totalLegacyAssignments).toBe(100);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
