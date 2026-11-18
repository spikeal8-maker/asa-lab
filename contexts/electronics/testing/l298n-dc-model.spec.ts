import { describe, expect, it } from 'vitest';
import type { SchematicComponent } from '../domain/document.js';
import { solveLinear } from '../domain/linear-system.js';
import {
  L298N_DC_MODEL,
  L298N_FLYBACK_PROFILE,
  L298N_TERMINALS,
  type L298nOperatingPoint,
} from '../domain/models/l298n-dc-model.js';

function board(state: Record<string, boolean> = {}): SchematicComponent {
  return {
    id: 'driver-1',
    kind: 'visual',
    componentTypeId: 'l298n-motor-driver',
    value: 0,
    position: { x: 0, y: 0 },
    pinIds: [...L298N_TERMINALS, 'ENA', 'ENB'],
    stateProperties: {
      enaJumperInstalled: true,
      enbJumperInstalled: true,
      regulatorJumperInstalled: false,
      ...state,
    },
  };
}

function step(
  component: SchematicComponent,
  inputs: Record<string, number>,
  driven: ReadonlySet<string> = new Set(['IN1', 'IN2', 'IN3', 'IN4', 'ENA', 'ENB']),
) {
  const instance = L298N_DC_MODEL.normalize(component);
  const point = {
    terminalVoltages: {
      '+12V': 9,
      GND: 0,
      '+5V': 5,
      OUT1: 0,
      OUT2: 0,
      OUT3: 0,
      OUT4: 0,
      IN1: 5,
      IN2: 0,
      IN3: 0,
      IN4: 5,
      ENA: 5,
      ENB: 5,
      ...inputs,
    },
    drivenTerminals: driven,
  };
  const initial = L298N_DC_MODEL.initialIterationState(instance);
  const first = L298N_DC_MODEL.evaluateIteration(instance, initial, point);
  const second = L298N_DC_MODEL.evaluateIteration(instance, first.state, point);
  expect(second.changed).toBe(false);
  return { instance, point, state: second.state, changed: first.changed };
}

function solveMotors(
  component: SchematicComponent,
  input: Record<string, number>,
  resistanceA = 10,
  resistanceB = 20,
) {
  const { instance, point, state } = step(component, input);
  const ids = [...L298N_TERMINALS, 'ENA', 'ENB'];
  const nodeId = new Map(ids.map((x, i) => [x, i]));
  const outputs = ['OUT1', 'OUT2', 'OUT3', 'OUT4'];
  const variableByNode = new Map(outputs.map((out, i) => [nodeId.get(out)!, i]));
  const fixedVoltage = new Map([
    [nodeId.get('+12V')!, 9],
    [nodeId.get('GND')!, 0],
    [nodeId.get('+5V')!, 5],
  ]);
  const n = 4;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  const rhs = Array(n).fill(0);
  function stamp(left: number, right: number, conductance: number) {
    const li = variableByNode.get(left),
      ri = variableByNode.get(right);
    if (li !== undefined) {
      matrix[li]![li] += conductance;
      if (ri !== undefined) matrix[li]![ri] -= conductance;
      else rhs[li] += conductance * (fixedVoltage.get(right) ?? 0);
    }
    if (ri !== undefined) {
      matrix[ri]![ri] += conductance;
      if (li !== undefined) matrix[ri]![li] -= conductance;
      else rhs[ri] += conductance * (fixedVoltage.get(left) ?? 0);
    }
  }
  stamp(nodeId.get('OUT1')!, nodeId.get('OUT2')!, 1 / resistanceA);
  stamp(nodeId.get('OUT3')!, nodeId.get('OUT4')!, 1 / resistanceB);
  L298N_DC_MODEL.stampDc(
    {
      node(_component, terminal) {
        return nodeId.get(terminal)!;
      },
      stampConductance: stamp,
      stampOffset() {
        throw new Error('No independent hidden current sources allowed');
      },
      stampVccs() {
        throw new Error('No independent hidden controlled current sources allowed');
      },
    },
    instance,
    state,
  );
  // Only the existing ASA Lab linear-system solver calculates the motor load.
  const solution = solveLinear(matrix, rhs);
  expect(solution).not.toBeNull();
  const terminalVoltages = {
    ...point.terminalVoltages,
    ...Object.fromEntries(outputs.map((key, i) => [key, solution![i]])),
  };
  const observation = L298N_DC_MODEL.observe(instance, state, {
    ...point,
    terminalVoltages,
  });
  return { state, terminalVoltages, observation, matrix, rhs };
}

describe('L298N device model feeding the canonical ASA Lab MNA solver', () => {
  it('requires exact owner terminals and models regulated logic only for valid VS', () => {
    expect(L298N_DC_MODEL.validate(board())).toEqual([]);
    const regulated = board({ regulatorJumperInstalled: true });
    expect(L298N_DC_MODEL.validate(regulated)).toEqual([]);
    expect(step(regulated, {}).state.regulatorOn).toBe(true);
    expect(step(regulated, { '+12V': 6 }).state.regulatorOn).toBe(false);
    expect(L298N_DC_MODEL.validate({ ...board(), pinIds: ['GND'] }).map((x) => x.code)).toContain(
      'l298n_missing_pin',
    );
  });

  it('allows externally wired PWM enables only when their shunts are removed', () => {
    const missing = {
      ...board({ enaJumperInstalled: false, enbJumperInstalled: false }),
      pinIds: [...L298N_TERMINALS],
    };
    expect(L298N_DC_MODEL.validate(missing).map((x) => x.code)).toEqual(
      expect.arrayContaining(['l298n_ena_missing', 'l298n_enb_missing']),
    );
    const component = board({ enaJumperInstalled: false, enbJumperInstalled: false });
    expect(step(component, { ENA: 5, ENB: 0 }).state.channelA.mode).toBe('forward');
    expect(step(component, { ENA: 5, ENB: 0 }).state.channelB.mode).toBe('coast');
    expect(step(component, { ENA: 0, ENB: 5 }).state.channelA.mode).toBe('coast');
    expect(step(component, { ENA: 0, ENB: 5 }).state.channelB.mode).toBe('reverse');
  });

  it('stamps two independent loaded H bridges, not two ideal voltage animations', () => {
    const solved = solveMotors(board(), {});
    expect(solved.state.channelA.mode).toBe('forward');
    expect(solved.state.channelB.mode).toBe('reverse');
    const voltageA = solved.terminalVoltages['OUT1']! - solved.terminalVoltages['OUT2']!;
    const voltageB = solved.terminalVoltages['OUT3']! - solved.terminalVoltages['OUT4']!;
    expect(voltageA).toBeCloseTo((9 * 10) / (10 + 2.4), 9);
    expect(voltageB).toBeCloseTo((-9 * 20) / (20 + 2.4), 9);
    expect(solved.observation.supplyCurrentAmp).toBeCloseTo(9 / (10 + 2.4) + 9 / (20 + 2.4), 9);
    expect(solved.observation.powerWatt).toBeGreaterThan(0);
    expect(solved.observation.overCurrent).toBe(false);
    expect(
      Object.values(solved.observation.terminalCurrents).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(0, 10);
  });

  it('models 00/11 brake and 01/10 direction separately on either channel', () => {
    expect(solveMotors(board(), { IN1: 0, IN2: 0 }).state.channelA.mode).toBe('brake-low');
    expect(solveMotors(board(), { IN1: 5, IN2: 5 }).state.channelA.mode).toBe('brake-high');
    expect(solveMotors(board(), { IN1: 0, IN2: 5 }).state.channelA.mode).toBe('reverse');
    expect(solveMotors(board(), { IN3: 5, IN4: 0 }).state.channelB.mode).toBe('forward');
  });

  it('has real logic-power LED truth; never lights from motor motion', () => {
    const off = step(board(), { '+5V': 0 });
    expect(off.state.logicPowered).toBe(false);
    expect(off.state.channelA.mode).toBe('coast');
    expect(L298N_DC_MODEL.observe(off.instance, off.state, off.point).ledOn).toBe(false);
    const noMotor = step(board(), { '+12V': 0 });
    expect(noMotor.state.motorPowered).toBe(false);
    expect(noMotor.state.channelA.mode).toBe('coast');
    expect(L298N_DC_MODEL.observe(noMotor.instance, noMotor.state, noMotor.point).ledOn).toBe(true);
  });

  it('does not interpret floating or indeterminate Arduino inputs as logic LOW', () => {
    const undriven = step(board(), {}, new Set(['IN2', 'IN3', 'IN4']));
    expect(undriven.state.channelA.mode).toBe('unknown');
    expect(
      L298N_DC_MODEL.observe(undriven.instance, undriven.state, undriven.point).unsupported,
    ).toBe(true);
    const invalid = step(board(), { IN1: 1.6 });
    expect(invalid.state.channelA.mode).toBe('unknown');
  });

  it('fails closed on >2 A current and does not invent a motor output', () => {
    const short = solveMotors(board(), {}, 0.3, 20);
    expect(short.observation.overCurrent).toBe(true);
    expect(short.observation.unsupported).toBe(true);
    expect(short.observation.supplyCurrentAmp).toBeGreaterThan(2);
  });

  it('is deterministic across repeated solves and independently configured instances', () => {
    const x = solveMotors(board(), {}, 8, 12);
    const y = solveMotors(board(), {}, 8, 12);
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
    const second = solveMotors(
      { ...board(), id: 'driver-2' },
      { IN1: 0, IN2: 5, IN3: 5, IN4: 0 },
      8,
      12,
    );
    expect(second.state.channelA.mode).toBe('reverse');
    expect(second.state.channelB.mode).toBe('forward');
  });
});

/** A held winding current is an interval-boundary constraint, not a new runtime solver. */
function solveHeldFlyback(pair: readonly [string, string], heldCurrentAmp: number, logicVolt = 5) {
  const component = board({ enaJumperInstalled: false, enbJumperInstalled: false });
  const prepared = step(component, { '+5V': logicVolt, ENA: 0, ENB: 0 });
  const { instance, point } = prepared;
  let state = prepared.state;
  const ids: readonly string[] = [...L298N_TERMINALS, 'ENA', 'ENB'];
  const nodeId = new Map(ids.map((name, index) => [name, index]));
  const outputs = ['OUT1', 'OUT2', 'OUT3', 'OUT4'];
  const variable = new Map(outputs.map((name, index) => [nodeId.get(name)!, index]));
  const fixed = new Map([
    [nodeId.get('+12V')!, 9],
    [nodeId.get('GND')!, 0],
    [nodeId.get('+5V')!, logicVolt],
  ]);
  for (let iteration = 0; iteration < 24; iteration++) {
    const matrix = Array.from({ length: 4 }, () => Array<number>(4).fill(0));
    const rhs = Array<number>(4).fill(0);
    for (let i = 0; i < 4; i++) matrix[i]![i] = 1e-12;
    const conductance = (left: number, right: number, g: number) => {
      const li = variable.get(left),
        ri = variable.get(right);
      if (li !== undefined) {
        matrix[li]![li] += g;
        if (ri !== undefined) matrix[li]![ri] -= g;
        else rhs[li] += g * (fixed.get(right) ?? 0);
      }
      if (ri !== undefined) {
        matrix[ri]![ri] += g;
        if (li !== undefined) matrix[ri]![li] -= g;
        else rhs[ri] += g * (fixed.get(left) ?? 0);
      }
    };
    const offset = (left: number, right: number, current: number) => {
      const li = variable.get(left),
        ri = variable.get(right);
      if (li !== undefined) rhs[li] += current;
      if (ri !== undefined) rhs[ri] -= current;
    };
    // Current through the winding leaves its first terminal, enters its second.
    offset(nodeId.get(pair[0])!, nodeId.get(pair[1])!, -heldCurrentAmp);
    L298N_DC_MODEL.stampDc(
      {
        node: (_component, terminal) => nodeId.get(terminal)!,
        stampConductance: conductance,
        stampOffset: offset,
        stampVccs: () => {
          throw new Error('Regulator is disabled in the flyback fixture');
        },
      },
      instance,
      state,
    );
    const solution = solveLinear(matrix, rhs);
    if (!solution) throw new Error('The shared linear solver rejected the flyback matrix');
    const currentPoint: L298nOperatingPoint = {
      ...point,
      terminalVoltages: {
        ...point.terminalVoltages,
        ...Object.fromEntries(outputs.map((name, index) => [name, solution[index]!])),
      },
    };
    const evaluated = L298N_DC_MODEL.evaluateIteration(instance, state, currentPoint);
    state = evaluated.state;
    if (!evaluated.changed)
      return {
        instance,
        state,
        point: currentPoint,
        iterations: iteration + 1,
        observation: L298N_DC_MODEL.observe(instance, state, currentPoint),
      };
  }
  throw new Error('Flyback active set did not converge within the unchanged iteration bound');
}

describe('L298N passive flyback in the shared MNA matrix', () => {
  it.each([
    ['OUT1', 'OUT2', 0.25],
    ['OUT1', 'OUT2', -0.25],
    ['OUT3', 'OUT4', 0.25],
    ['OUT3', 'OUT4', -0.25],
  ] as const)('preserves signed coast current from %s to %s at %s A', (a, b, current) => {
    const result = solveHeldFlyback([a, b], current);
    const { terminalCurrents: currents, powerWatt, supplyCurrentAmp } = result.observation;
    const magnitude = Math.abs(current);
    const knee = L298N_FLYBACK_PROFILE.forwardVoltageVolt;
    const resistance = L298N_FLYBACK_PROFILE.dynamicResistanceOhm;
    expect(result.iterations).toBeLessThan(24);
    expect(result.state.channelA.mode).toBe('coast');
    expect(result.state.channelB.mode).toBe('coast');
    expect(currents[a]).toBeCloseTo(-current, 9);
    expect(currents[b]).toBeCloseTo(current, 9);
    expect(supplyCurrentAmp).toBeCloseTo(-magnitude, 9);
    expect(Object.values(currents).reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 11);
    const voltage = result.point.terminalVoltages[a] - result.point.terminalVoltages[b];
    expect(voltage).toBeCloseTo(-Math.sign(current) * (9 + 2 * (knee + magnitude * resistance)), 9);
    expect(powerWatt).toBeCloseTo(25 / 1250 + 2 * magnitude * (knee + magnitude * resistance), 9);
    const terminalPower = Object.entries(currents).reduce(
      (sum, [terminal, amperes]) => sum + result.point.terminalVoltages[terminal] * amperes,
      0,
    );
    expect(terminalPower).toBeCloseTo(powerWatt, 9);
    expect(result.observation.overCurrent).toBe(false);
    expect(result.observation.unsupported).toBe(false);
  });

  it('keeps the passive current path when logic power is absent', () => {
    const result = solveHeldFlyback(['OUT1', 'OUT2'], 0.25, 0);
    expect(result.state.logicPowered).toBe(false);
    expect(result.observation.ledOn).toBe(false);
    expect(result.observation.terminalCurrents['OUT1']).toBeCloseTo(-0.25, 9);
    expect(result.observation.supplyCurrentAmp).toBeCloseTo(-0.25, 9);
    expect(result.observation.powerWatt).toBeCloseTo(2 * 0.25 * (0.7 + 0.25 * 0.1), 9);
  });

  it('returns reverse-biased clamps to the off active set without hidden loss', () => {
    const result = solveHeldFlyback(['OUT1', 'OUT2'], 0.25);
    const inactivePoint = {
      ...result.point,
      terminalVoltages: {
        ...result.point.terminalVoltages,
        OUT1: 4,
        OUT2: 4,
        OUT3: 4,
        OUT4: 4,
      },
    };
    const update = L298N_DC_MODEL.evaluateIteration(result.instance, result.state, inactivePoint);
    expect(update.changed).toBe(true);
    expect(update.state.flybackMask).toBe(0);
    const observation = L298N_DC_MODEL.observe(result.instance, update.state, inactivePoint);
    expect(observation.terminalCurrents['OUT1']).toBe(0);
    expect(observation.terminalCurrents['OUT2']).toBe(0);
    expect(observation.supplyCurrentAmp).toBe(0);
    expect(observation.powerWatt).toBeCloseTo(25 / 1250, 12);
  });

  it.each([2.1, -2.1])('does not waive the 2 A limit on a clamp path at %s A', (current) => {
    const result = solveHeldFlyback(['OUT3', 'OUT4'], current);
    expect(result.observation.overCurrent).toBe(true);
    expect(result.observation.unsupported).toBe(true);
  });

  it('is deterministic and does not mutate iteration state during stamping', () => {
    const first = solveHeldFlyback(['OUT1', 'OUT2'], 0.25);
    expect(JSON.stringify(solveHeldFlyback(['OUT1', 'OUT2'], 0.25))).toBe(JSON.stringify(first));
    const frozen = Object.freeze({ ...first.state });
    const before = JSON.stringify(frozen);
    L298N_DC_MODEL.stampDc(
      {
        node: (_component, terminal) => [...L298N_TERMINALS, 'ENA', 'ENB'].indexOf(terminal),
        stampConductance: () => {},
        stampOffset: () => {},
        stampVccs: () => {},
      },
      first.instance,
      frozen,
    );
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe('L298N reviewed voltage ratings, TTL boundaries and total output current', () => {
  const disabledBoard = () =>
    board({
      enaJumperInstalled: false,
      enbJumperInstalled: false,
    });

  it.each([
    { label: 'logic overvoltage', pin: '+5V', voltage: 6 },
    { label: 'motor overvoltage', pin: '+12V', voltage: 36 },
    { label: 'negative logic supply', pin: '+5V', voltage: -0.31 },
    { label: 'negative motor supply', pin: '+12V', voltage: -0.31 },
  ])('fails closed on $label even with both bridges disabled', ({ pin, voltage }) => {
    const evaluated = step(disabledBoard(), { ENA: 0, ENB: 0, [pin]: voltage });
    const observation = L298N_DC_MODEL.observe(
      evaluated.instance,
      evaluated.state,
      evaluated.point,
    );
    expect(evaluated.state.voltageOutOfRange).toBe(true);
    expect(observation.overCurrent).toBe(false);
    expect(observation.unsupported).toBe(true);
  });

  it.each(['IN1', 'IN2', 'IN3', 'IN4', 'ENA', 'ENB'])(
    'rejects 8 V on driven %s independently of the enable state',
    (pin) => {
      const evaluated = step(disabledBoard(), { ENA: 0, ENB: 0, [pin]: 8 });
      const observation = L298N_DC_MODEL.observe(
        evaluated.instance,
        evaluated.state,
        evaluated.point,
      );
      expect(evaluated.state.voltageOutOfRange).toBe(true);
      expect(observation.overCurrent).toBe(false);
      expect(observation.unsupported).toBe(true);
    },
  );

  it.each(
    ['IN1', 'IN2', 'IN3', 'IN4', 'ENA', 'ENB'].flatMap((pin) =>
      [8, -1].map((voltage) => ({ pin, voltage })),
    ),
  )('rejects $voltage V on $pin without a recognised driver', ({ pin, voltage }) => {
    const driven = new Set(['IN1', 'IN2', 'IN3', 'IN4', 'ENA', 'ENB']);
    driven.delete(pin);
    const evaluated = step(disabledBoard(), { ENA: 0, ENB: 0, [pin]: voltage }, driven);
    const observation = L298N_DC_MODEL.observe(
      evaluated.instance,
      evaluated.state,
      evaluated.point,
    );
    expect(evaluated.state.voltageOutOfRange).toBe(true);
    expect(observation.unsupported).toBe(true);
  });

  it('keeps a normal loss of power distinct from a voltage-rating violation', () => {
    for (const power of [
      { '+12V': 0, '+5V': 0 },
      { '+12V': 9, '+5V': 0 },
      { '+12V': 0, '+5V': 5 },
    ]) {
      const evaluated = step(disabledBoard(), {
        ...power,
        ENA: 0,
        ENB: 0,
        IN1: 0,
        IN2: 0,
        IN3: 0,
        IN4: 0,
      });
      const observation = L298N_DC_MODEL.observe(
        evaluated.instance,
        evaluated.state,
        evaluated.point,
      );
      expect(evaluated.state.voltageOutOfRange).toBe(false);
      expect(evaluated.state.channelA.mode).toBe('coast');
      expect(evaluated.state.channelB.mode).toBe('coast');
      expect(observation.unsupported).toBe(false);
    }
  });

  it.each([
    { voltage: 1.5, mode: 'brake-low', known: true },
    { voltage: 2.1, mode: 'unknown', known: false },
    { voltage: 2.3, mode: 'forward', known: true },
  ])('uses the guaranteed TTL boundary at $voltage V', ({ voltage, mode, known }) => {
    const evaluated = step(disabledBoard(), { ENA: 5, ENB: 0, IN1: voltage, IN2: 0 });
    expect(evaluated.state.voltageOutOfRange).toBe(false);
    expect(evaluated.state.channelA.mode).toBe(mode);
    expect(evaluated.state.inputKnown).toBe(known);
  });

  it("does not confuse a disabled bridge don't-care input with electrical overvoltage", () => {
    const evaluated = step(disabledBoard(), { ENA: 0, ENB: 0, IN1: 2.1 });
    const observation = L298N_DC_MODEL.observe(
      evaluated.instance,
      evaluated.state,
      evaluated.point,
    );
    expect(evaluated.state.voltageOutOfRange).toBe(false);
    expect(evaluated.state.inputKnown).toBe(true);
    expect(evaluated.state.channelA.mode).toBe('coast');
    expect(observation.unsupported).toBe(false);
  });

  it.each([
    {
      channel: 'A',
      firstOutput: 'OUT1',
      secondOutput: 'OUT2',
      firstInput: 'IN1',
      secondInput: 'IN2',
      enable: 'ENA',
    },
    {
      channel: 'B',
      firstOutput: 'OUT3',
      secondOutput: 'OUT4',
      firstInput: 'IN3',
      secondInput: 'IN4',
      enable: 'ENB',
    },
  ])(
    'limits total regenerative output current on channel $channel, including diode and transistor paths',
    ({ firstOutput, secondOutput, firstInput, secondInput, enable }) => {
      // At each output, the 0.85 V rail excursion drives 0.708333 A through
      // the on-stage and 1.5 A through the flyback diode: 2.208333 A in total.
      // Every individual branch is below 2 A, so a branch-only guard misses it.
      const evaluated = step(disabledBoard(), {
        ENA: 0,
        ENB: 0,
        IN1: 0,
        IN2: 0,
        IN3: 0,
        IN4: 0,
        [firstInput]: 5,
        [secondInput]: 0,
        [enable]: 5,
        [firstOutput]: 9.85,
        [secondOutput]: -0.85,
      });
      const observation = L298N_DC_MODEL.observe(
        evaluated.instance,
        evaluated.state,
        evaluated.point,
      );
      expect(evaluated.state.voltageOutOfRange).toBe(false);
      expect(observation.terminalCurrents[firstOutput]).toBeCloseTo(2.208333333333333, 12);
      expect(observation.terminalCurrents[secondOutput]).toBeCloseTo(-2.208333333333333, 12);
      expect(observation.overCurrent).toBe(true);
      expect(observation.unsupported).toBe(true);
      const totalCurrent = Object.values(observation.terminalCurrents).reduce(
        (sum, current) => sum + current,
        0,
      );
      const operatingPoint: L298nOperatingPoint = evaluated.point;
      const terminalPower = Object.entries(observation.terminalCurrents).reduce(
        (sum, [terminal, current]) =>
          sum + current * (operatingPoint.terminalVoltages[terminal] ?? 0),
        0,
      );
      expect(totalCurrent).toBeCloseTo(0, 12);
      expect(terminalPower).toBeCloseTo(observation.powerWatt, 12);
    },
  );
});
