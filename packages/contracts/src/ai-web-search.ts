/** Server-issued internet evidence; provider secrets are never part of these DTOs. */
export type AiWebSearchMode = 'off' | 'auto' | 'web' | 'images' | 'weather';

export interface AiWebSource {
  readonly id: number;
  readonly title: string;
  readonly url: string;
  readonly hostname: string;
  readonly snippet: string;
}

export interface AiWebImage {
  readonly id: number;
  readonly title: string;
  readonly thumbnailUrl: string;
  readonly sourceUrl: string;
  readonly width?: number;
  readonly height?: number;
}

export interface AiWebWeather {
  readonly provider: 'met-norway';
  readonly forecastUpdatedAt: string;
  readonly forecastAt: string;
  readonly attributions: readonly { readonly title: string; readonly url: string }[];
  readonly location: string;
  readonly sourceUrl: string;
  readonly temperatureC: number | null;
  readonly hours: readonly {
    readonly time: string;
    readonly temperatureC: number;
    readonly humidityPercent: number | null;
    readonly pressureHpa: number | null;
    readonly windSpeedMs: number | null;
  }[];
}

export interface AiWebSearchEvidence {
  readonly schemaVersion: 1;
  readonly provider: 'searxng';
  readonly mode: 'web' | 'images' | 'weather';
  readonly status: 'ready' | 'empty' | 'unavailable' | 'limited' | 'needs_location';
  readonly query: string;
  readonly retrievedAt: string;
  readonly sources: readonly AiWebSource[];
  readonly images: readonly AiWebImage[];
  readonly diagnostics?: AiWebSearchDiagnostics;
  readonly weather?: AiWebWeather;
  readonly locationChoices?: readonly string[];
  readonly reason?:
    | 'not_configured'
    | 'provider_unavailable'
    | 'weather_unavailable'
    | 'location_required'
    | 'location_ambiguous'
    | 'rate_limit'
    | 'unsafe_query'
    | 'upstream_empty'
    | 'invalid_results'
    | 'domain_filtered'
    | 'provider_partial_failure';
}

/** Bounded counts from one provider response, never a claim about the whole web. */
export interface AiWebSearchDiagnostics {
  readonly rawCount: number;
  readonly validatedCount: number;
  readonly postDomainCount: number;
  readonly engineFailureCount: number;
  readonly partial: boolean;
}

export interface AiWebSearchProbeResult {
  readonly schemaVersion: 1;
  readonly checkedAt: string;
  readonly modes: readonly {
    readonly mode: 'web' | 'images';
    readonly status: 'results' | 'empty' | 'invalid' | 'filtered' | 'partial' | 'unavailable';
    readonly durationMs: number;
    readonly diagnostics?: AiWebSearchDiagnostics;
  }[];
}

export interface AiWebSearchStatus {
  readonly schemaVersion: 1;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly weatherConfigured: boolean;
  readonly provider: 'searxng';
}

export interface AiWebSearchAdminConfig extends AiWebSearchStatus {
  readonly allowedDomains: readonly string[];
  readonly blockedDomains: readonly string[];
  readonly searchInstructions: string;
  readonly weatherEnabled: boolean;
  readonly operationsPerHour: number;
  readonly configurationVersion: number;
}

export interface AiWebSearchAdminUpdate {
  readonly allowedDomains?: readonly string[];
  readonly blockedDomains?: readonly string[];
  readonly searchInstructions?: string;
  readonly enabled: boolean;
  readonly weatherEnabled: boolean;
  readonly operationsPerHour: number;
  readonly configurationVersion: number;
}
