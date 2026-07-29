import { describe, expect, it } from 'vitest';
import { parseElectronicsDocument, type ElectronicsDocument } from '../domain/document';
import { buildNetlist, terminalKey } from '../domain/netlist';
import { solveCircuit } from '../domain/solver';

function attachedSeriesCircuit(): ElectronicsDocument {
  const parsed = parseElectronicsDocument({
    schemaVersion: 1,
    geometryProfile: 'breadboard-2.54mm-v1',
    components: [
      { id: 'board', kind: 'breadboard', position: { x: 100, y: 100 }, value: 0 },
      { id: 'src', kind: 'source', position: { x: 20, y: 20 }, value: 3 },
      { id: 'r1', kind: 'resistor', position: { x: 150, y: 140 }, value: 100 },
      { id: 'led1', kind: 'led', position: { x: 210, y: 140 }, value: 2 },
    ],
    connections: [
      {
        id: 'wire-positive',
        from: { componentId: 'src', terminal: 'a' },
        to: { componentId: 'board', terminal: 'half-400:terminal:1:a' },
      },
      {
        id: 'wire-negative',
        from: { componentId: 'src', terminal: 'b' },
        to: { componentId: 'board', terminal: 'half-400:terminal:3:e' },
      },
    ],
    breadboardAttachments: [
      {
        id: 'att-r1-a',
        breadboardComponentId: 'board',
        breadboardTerminalId: 'half-400:terminal:1:e',
        componentId: 'r1',
        componentTerminalId: 'a',
      },
      {
        id: 'att-r1-b',
        breadboardComponentId: 'board',
        breadboardTerminalId: 'half-400:terminal:2:a',
        componentId: 'r1',
        componentTerminalId: 'b',
      },
      {
        id: 'att-led-a',
        breadboardComponentId: 'board',
        breadboardTerminalId: 'half-400:terminal:2:e',
        componentId: 'led1',
        componentTerminalId: 'a',
      },
      {
        id: 'att-led-b',
        breadboardComponentId: 'board',
        breadboardTerminalId: 'half-400:terminal:3:a',
        componentId: 'led1',
        componentTerminalId: 'b',
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

describe('breadboard attachment netlist', () => {
  it('collapses component leads, physical holes and internal strips into electrical nets', () => {
    const document = attachedSeriesCircuit();
    const netlist = buildNetlist(document);

    expect(netlist.nodeOf.get(terminalKey('src', 'a'))).toBe(
      netlist.nodeOf.get(terminalKey('r1', 'a')),
    );
    expect(netlist.nodeOf.get(terminalKey('r1', 'b'))).toBe(
      netlist.nodeOf.get(terminalKey('led1', 'a')),
    );
    expect(netlist.nodeOf.get(terminalKey('led1', 'b'))).toBe(
      netlist.nodeOf.get(terminalKey('src', 'b')),
    );
    expect(netlist.nodeOf.get(terminalKey('r1', 'a'))).not.toBe(
      netlist.nodeOf.get(terminalKey('r1', 'b')),
    );
  });

  it('solves the same honest series circuit when leads are inserted through a breadboard', () => {
    const result = solveCircuit(attachedSeriesCircuit());
    expect(result.solved).toBe(true);
    expect(result.current).toBeCloseTo(0.01, 6);
    expect(result.components.find((component) => component.componentId === 'led1')).toMatchObject({
      current: 0.01,
      voltageDrop: 2,
      lit: true,
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['circuit_ok']);
  });
});
