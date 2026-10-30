import type { ElectronicsSimulationArtifact } from '@asa-lab/contracts';
import type { SchematicComponent, SchematicDocument, SolveResult } from '../api';
import { catalogEntry, visualAsset } from '../electronics/component-catalog';
import { ordinaryLedVisualState } from '../electronics/component-result-presentation';
import { ElectronicsLiveSimulationWorkerController } from '../electronics/live-simulation-worker-controller';
import { ElectronicsSimulationWorkerClient } from '../electronics/simulation-worker-client';
import {
  LedTemporalPresentation,
  classroomRequestedHorizon,
  type LedPresentationFrame,
} from '../electronics/led-temporal-presentation';
import {
  NativeOpticalPresentation,
  type NativeOpticalObservation,
} from '../electronics/native-optical-presentation';
import type { LedAssetReadiness } from '../electronics/ProductionComponentVisual';

export const PUBLIC_SIMULATION_BUDGET = Object.freeze({
  requestMs: 4000,
  sessionMs: 300000,
  inputsPerSecond: 30,
  inputsPerSession: 512,
  assetMs: 3000,
});

/** The artifact is already validated. Reconstruct only public execution inputs. */
export function publicSimulationDocument(
  artifact: ElectronicsSimulationArtifact,
): SchematicDocument {
  return {
    schemaVersion: 4,
    components: artifact.components.map(
      ({ visualProperties, pinIds, internalConnections, ...component }) => ({
        ...component,
        ...(pinIds ? { pinIds: [...pinIds] } : {}),
        ...(internalConnections
          ? { internalConnections: internalConnections.map(([a, b]): [string, string] => [a, b]) }
          : {}),
        stateProperties: { ...visualProperties, ...component.stateProperties },
      }),
    ),
    connections: artifact.connections.map(({ vertices, ...connection }) => ({
      ...connection,
      ...(vertices ? { vertices: vertices.map((point) => ({ ...point })) } : {}),
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: artifact.solverIterations },
  };
}

interface PendingFrame {
  frame: LedPresentationFrame;
  result: SolveResult;
  assets: Map<string, string>;
  leases: Map<string, LedAssetReadiness>;
  created: number;
  observation?: NativeOpticalObservation;
}

/** A transient public host. Owns no Project API, persistence, editor, or solver. */
export class PublicElectronicsRuntime {
  readonly port = new NativeOpticalPresentation();
  private readonly timeline = new LedTemporalPresentation();
  private readonly controller: ElectronicsLiveSimulationWorkerController;
  private active = false;
  private ready = false;
  private raf = 0;
  private started = 0;
  private offset = 0;
  private horizon = 0;
  private latest: SolveResult | null = null;
  private pending: PendingFrame | null = null;
  private inputWindow = 0;
  private inputWindowCount = 0;
  private inputCount = 0;
  private document: SchematicDocument;
  constructor(
    readonly artifact: ElectronicsSimulationArtifact,
    private readonly onStop: (message?: string) => void,
    controller = new ElectronicsLiveSimulationWorkerController(
      new ElectronicsSimulationWorkerClient(undefined, PUBLIC_SIMULATION_BUDGET.requestMs),
    ),
  ) {
    this.document = publicSimulationDocument(artifact);
    this.controller = controller;
    this.port.setBarrier((snapshot) => {
      const pending = this.pending;
      if (!this.active || !pending?.observation || snapshot.observation !== pending.observation)
        return;
      if (!this.leasesReady(pending, true)) {
        // No partial native vector is committed; retain the prior complete frame.
        this.port.setObservation(snapshot.committed);
        delete pending.observation;
        return;
      }
      if (!this.timeline.acknowledgeFrame(pending.frame, performance.now() * 1000, true)) return;
      this.port.commit(pending.observation);
      this.port.setClock(pending.frame.atMicroseconds);
      this.pending = null;
    });
  }
  start(): void {
    if (this.active) return;
    this.active = true;
    this.started = performance.now();
    this.inputWindow = this.started;
    this.controller.start(
      `publication:${this.artifact.provenance.publicationId}:${this.artifact.provenance.revisionNumber}`,
      this.document,
      {
        onInitialReady: (offset) => {
          if (this.active) {
            this.offset = offset;
            this.ready = true;
            this.started = performance.now();
          }
        },
        readHostHorizonMicroseconds: () =>
          this.active && this.ready ? this.requestedHorizon() : null,
        onResult: (result, temporal) => {
          if (!this.active) return;
          this.latest = result;
          if (temporal) this.timeline.accept(result, temporal, performance.now() * 1000);
          else this.timeline.acceptSnapshot(result, this.horizon);
        },
        onCommittedHorizon: (horizon) => {
          this.horizon = horizon;
        },
        onFailure: (failure) => this.stop(`Моделирование остановлено: ${failure.message}`),
      },
    );
    if (this.active) this.raf = requestAnimationFrame(this.tick);
  }
  private requestedHorizon(): number {
    return classroomRequestedHorizon(
      this.offset,
      (performance.now() - this.started) * 1000,
      this.timeline.presentedMicroseconds,
    );
  }
  private readonly tick = (): void => {
    if (!this.active) return;
    const now = performance.now();
    if (now - this.started >= PUBLIC_SIMULATION_BUDGET.sessionMs) {
      this.stop('Время просмотра истекло. Можно запустить схему снова.');
      return;
    }
    if (this.ready) this.controller.update(this.document, this.requestedHorizon());
    if (this.pending) {
      if (now - this.pending.created > PUBLIC_SIMULATION_BUDGET.assetMs) {
        this.stop('Не удалось подготовить изображение компонента. Попробуйте снова.');
        return;
      }
      this.publishReady();
    } else if (this.latest) {
      const frame = this.timeline.prepareInitialFrame() ?? this.timeline.prepareFrame(now * 1000);
      if (frame) {
        const assets = new Map<string, string>();
        for (const component of this.document.components) {
          const entry = catalogEntry(component);
          if (component.kind !== 'led' || entry?.key !== 'led-5mm') continue;
          const result = this.latest.components.find((r) => r.componentId === component.id);
          const brightness = Math.round(
            Math.max(
              0,
              Math.min(100, frame.brightness.get(component.id) ?? result?.brightness ?? 0),
            ),
          );
          const state = ordinaryLedVisualState(result);
          assets.set(
            component.id,
            visualAsset(
              entry,
              {
                ...component,
                stateProperties: { ...component.stateProperties, ledBrightness: brightness },
              },
              state === 'lit' || state === 'off' ? (brightness > 0 ? 'lit' : 'off') : state,
            ),
          );
        }
        this.pending = { frame, result: this.latest, assets, leases: new Map(), created: now };
        this.port.setPreparation({ token: frame.token, assets });
        this.publishReady();
      }
    }
    if (this.active) this.raf = requestAnimationFrame(this.tick);
  };
  private leasesReady(pending: PendingFrame, active = false): boolean {
    return [...pending.assets].every(([id, asset]) => {
      const lease = pending.leases.get(id);
      return (
        lease?.status === 'ready' &&
        lease.token === pending.frame.token &&
        lease.asset === asset &&
        lease.isCurrent() &&
        (!active || lease.isActive())
      );
    });
  }
  private publishReady(): void {
    const pending = this.pending;
    if (
      !this.active ||
      !pending ||
      pending.observation ||
      !this.timeline.canPublishDistinctFrame ||
      !this.leasesReady(pending)
    )
      return;
    pending.observation = {
      frame: pending.frame,
      result: pending.result,
      ledAssets: new Map(pending.leases),
    };
    this.port.setRollback(this.port.getSnapshot().committed?.ledAssets ?? null);
    this.port.setObservation(pending.observation, true);
  }
  readonly assetReadiness = (lease: LedAssetReadiness): void => {
    const pending = this.pending;
    if (
      !this.active ||
      !pending ||
      lease.token !== pending.frame.token ||
      lease.asset !== pending.assets.get(lease.componentId)
    )
      return;
    if (lease.status === 'ready' && lease.isCurrent()) pending.leases.set(lease.componentId, lease);
    else pending.leases.delete(lease.componentId);
    // A load callback is not a presentation ACK. Publish on the next host RAF;
    // only the provider's joint native layout barrier acknowledges the cursor.
  };
  input(
    componentId: string,
    patch: Pick<SchematicComponent, 'state' | 'wiperPosition'>,
  ): SchematicComponent | null {
    if (!this.active || !this.ready) return null;
    const source = this.document.components.find((c) => c.id === componentId);
    if (!source || !['button', 'switch', 'potentiometer'].includes(source.kind)) return null;
    if (
      patch.state !== undefined &&
      (typeof patch.state !== 'boolean' || source.kind === 'potentiometer')
    )
      return null;
    if (
      patch.wiperPosition !== undefined &&
      (source.kind !== 'potentiometer' ||
        !Number.isFinite(patch.wiperPosition) ||
        patch.wiperPosition < 0 ||
        patch.wiperPosition > 1)
    )
      return null;
    if (
      Object.entries(patch).every(
        ([key, value]) => source[key as keyof SchematicComponent] === value,
      )
    )
      return null;
    const now = performance.now();
    if (now - this.inputWindow >= 1000) {
      this.inputWindow = now;
      this.inputWindowCount = 0;
    }
    if (
      ++this.inputWindowCount > PUBLIC_SIMULATION_BUDGET.inputsPerSecond ||
      ++this.inputCount > PUBLIC_SIMULATION_BUDGET.inputsPerSession
    ) {
      // Cancel the entire generation (including queued press events). Never drop
      // a release while leaving a live Worker with a pressed input.
      this.stop('Слишком много действий. Запустите моделирование снова.');
      return null;
    }
    const updated = { ...source, ...patch };
    this.document = {
      ...this.document,
      components: this.document.components.map((c) => (c.id === componentId ? updated : c)),
    };
    this.controller.update(this.document, this.requestedHorizon());
    return updated;
  }
  stop(message?: string): void {
    if (!this.active) return;
    this.active = false;
    this.ready = false;
    cancelAnimationFrame(this.raf);
    this.controller.dispose();
    this.pending = null;
    this.latest = null;
    this.document = publicSimulationDocument(this.artifact);
    this.timeline.reset();
    this.port.setPreparation(null);
    this.port.setRollback(null);
    this.port.setObservation(null);
    this.port.setClock(0);
    this.onStop(message);
  }
  dispose(): void {
    this.stop();
    this.controller.dispose();
    this.port.setBarrier(null);
  }
}
