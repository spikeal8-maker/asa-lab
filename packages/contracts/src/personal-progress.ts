/** Own progress only: no roster, identity links, permissions or personal score formula. */
export type ProgressAvailabilityV1 = 'available' | 'partial' | 'unavailable';

export type ProgressScopeV1 =
  | { readonly kind: 'account'; readonly accountId: string }
  | { readonly kind: 'seat'; readonly seatId: string; readonly classroomId: string };

export type ProgressMetricNameV1 =
  'everPublishedWorks' | 'currentLikes' | 'createdCopies' | 'activePublicWorks';

export type ProgressCounterV1 =
  | { readonly availability: 'available'; readonly value: number }
  | {
      readonly availability: 'unavailable';
      readonly value: null;
      readonly reason: 'source_unavailable';
    };

export interface ProgressCoverageV1 {
  readonly basis:
    | 'confirmed_publication_revisions'
    | 'current_publication_likes'
    | 'durable_publication_copy_receipts'
    | 'current_catalog_visibility';
  /** Completeness concerns this basis, never all activity since registration. */
  readonly completeness: 'complete' | 'partial' | 'unknown';
  readonly knownSince: string | null;
  readonly limitations: readonly (
    'history_before_canonical_records_unknown' | 'copies_not_supported_by_all_modules'
  )[];
}

export type OwnGroupResultV1 =
  | {
      readonly availability: 'available';
      readonly score: number | null;
      readonly rank: number | null;
    }
  | {
      readonly availability: 'unavailable';
      readonly score: null;
      readonly rank: null;
      readonly reason: 'ambiguous_self_participant' | 'source_unavailable';
    };

export interface OwnProgressGroupV1 {
  readonly groupId: string;
  readonly title: string;
  readonly periodDays: 7 | 30 | 90;
  readonly own: OwnGroupResultV1;
}

export interface PersonalProgressSummaryV1 {
  readonly scope: ProgressScopeV1;
  readonly asOf: string | null;
  readonly availability: ProgressAvailabilityV1;
  readonly metrics: Readonly<Record<ProgressMetricNameV1, ProgressCounterV1>>;
  readonly coverage: Readonly<Record<ProgressMetricNameV1, ProgressCoverageV1>>;
  readonly personalRating: { readonly availability: 'not_enabled'; readonly value: null };
  readonly groups: {
    readonly availability: ProgressAvailabilityV1;
    readonly items: readonly OwnProgressGroupV1[] | null;
    readonly hasMore: boolean | null;
    readonly nextCursor: string | null;
  };
}

/**
 * SP-04: the learner is a separately anchored element. Other members expose
 * no account, seat, display name, classroom roster, grades or project IDs.
 * The server supplies authenticated, short-lived encrypted image tickets.
 */
export interface GroupRatingPeerV1 {
  readonly peerKey: string;
  readonly avatarSrc: string;
  readonly avatarTicket: string | null;
  readonly score: number | null;
  readonly rank: number | null;
  readonly isSelf: false;
}

export type GroupRatingOwnV1 =
  | {
      readonly availability: 'available';
      readonly score: number | null;
      readonly rank: number | null;
      readonly isSelf: true;
    }
  | {
      readonly availability: 'unavailable';
      readonly score: null;
      readonly rank: null;
      readonly isSelf: true;
      readonly reason: 'source_unavailable' | 'rating_disabled';
    };

export interface GroupRatingPageV1 {
  readonly groupId: string;
  readonly periodDays: 7 | 30 | 90;
  readonly version: string;
  readonly asOf: string;
  readonly own: GroupRatingOwnV1;
  readonly peers: readonly GroupRatingPeerV1[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export interface GroupRatingAvatarBatchV1 {
  readonly items: readonly { readonly ticket: string; readonly dataUrl: string }[];
}

export const PERSONAL_PROGRESS_GROUP_LIMIT = 20;
export const GROUP_RATING_PAGE_LIMIT = 20;
