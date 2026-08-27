import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../api';
import { diagnosticsGroupedByComponent } from '../diagnostic-presentation';

describe('electronics diagnostic presentation', () => {
  it('keeps a short-circuit badge on its explicit source without marking peer sources', () => {
    const diagnostics: Diagnostic[] = [
      {
        code: 'short_circuit',
        severity: 'error',
        message: 'shorted source',
        componentIds: ['shorted-source'],
      },
      {
        code: 'source_overload',
        severity: 'error',
        message: 'overloaded source',
        componentIds: ['shorted-source'],
      },
    ];

    const grouped = diagnosticsGroupedByComponent(diagnostics);

    expect([...grouped.keys()]).toEqual(['shorted-source']);
    expect(grouped.has('loaded-source')).toBe(false);
    expect(grouped.has('open-source')).toBe(false);
  });

  it('does not invent component badges for an unanchored document diagnostic', () => {
    const diagnostics: Diagnostic[] = [
      {
        code: 'numerical_instability',
        severity: 'error',
        message: 'document-level failure',
      },
    ];

    expect(diagnosticsGroupedByComponent(diagnostics).size).toBe(0);
  });
});
