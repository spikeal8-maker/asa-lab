import { newClientId } from './client-id';
import { actorKey, record, sendTelemetry, type TelemetryActor } from './telemetry-contract';

export type CampaignObservation = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
};
const slug = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Only controlled campaign slugs leave this function. Never retain the URL or other query keys. */
export function campaignObservation(search: string): CampaignObservation | null {
  if (search.length > 4096) return null;
  const params = new URLSearchParams(search);
  const result: CampaignObservation = { source: null, medium: null, campaign: null };
  for (const key of ['source', 'medium', 'campaign'] as const) {
    const values = params.getAll(`utm_${key}`);
    if (values.length > 1) return null;
    if (values.length) {
      const value = values[0]!.toLowerCase();
      if (!slug.test(value)) return null;
      result[key] = value;
    }
  }
  return Object.values(result).some(Boolean) ? result : null;
}

/** Independent, memory-only optional queue: one current document, one authenticated binding.
 * No anonymous storage or replay after a different Account/Seat/context becomes active. */
export class AcquisitionObservation {
  private consumed = false;
  private binding = '';
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  readonly quality = { attempted: 0, acknowledged: 0, retried: 0, rejected: 0, expired: 0 };
  constructor(
    private readonly observation: CampaignObservation | null,
    private readonly transport: typeof fetch = fetch,
  ) {}
  update(actor: TelemetryActor | null): void {
    const binding = actorKey(actor);
    if (this.binding && binding !== this.binding) this.stop();
    if (this.consumed || !actor || !this.observation) return;
    this.consumed = true;
    this.binding = binding;
    const eventId = newClientId();
    const body = { schemaVersion: 1, eventId, actorExpectation: actor, ...this.observation };
    const deadline = Date.now() + 180_000;
    let attempts = 0;
    const deliver = async () => {
      if (this.binding !== binding) return;
      if (Date.now() >= deadline || attempts >= 8) {
        this.quality.expired++;
        return;
      }
      attempts++;
      this.quality.attempted++;
      this.controller = new AbortController();
      const result = await sendTelemetry(
        '/api/analytics/v2/acquisition',
        body,
        {
          status: 200,
          confirmed: (v) =>
            record(v) &&
            v.accepted === true &&
            v.state === 'persisted' &&
            v.schemaVersion === 2 &&
            typeof v.receivedAt === 'string' &&
            Number.isFinite(Date.parse(v.receivedAt)) &&
            v.eventId === eventId &&
            v.receiptId === eventId &&
            v.operation === 'acquisition.observed' &&
            typeof v.persistedAt === 'string' &&
            Number.isFinite(Date.parse(v.persistedAt)),
        },
        this.transport,
        this.controller.signal,
      );
      if (this.binding !== binding) return;
      if (result.kind === 'acknowledged') {
        this.quality.acknowledged++;
        return;
      }
      if (result.kind === 'rejected') {
        this.quality.rejected++;
        return;
      }
      this.quality.retried++;
      this.timer = setTimeout(
        () => {
          void deliver();
        },
        Math.min(30_000, 1000 * 2 ** attempts),
      );
    };
    void deliver();
  }
  stop(): void {
    this.binding = '';
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
  }
}

let current: AcquisitionObservation | undefined;
export function observeCurrentAcquisition(actor: TelemetryActor | null): void {
  if (!current) {
    let observation: CampaignObservation | null = null;
    try {
      observation = campaignObservation(window.location.search);
    } catch {
      /* No URL fallback. */
    }
    current = new AcquisitionObservation(observation);
  }
  current.update(actor);
}
