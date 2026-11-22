/**
 * Owns one assignment-dialog flow inside one committed classroom context.
 * Tokens are compared by identity. An old picker/editor cannot act on a new
 * stage, a replacement provider, a remounted scope or a later focus request.
 * No API requests, React state or shared notification store are owned here.
 */
export interface AssignmentStageToken {
  readonly kind: 'assignment-stage';
  readonly sequence: number;
}

export interface AssignmentFocusTicket {
  readonly kind: 'assignment-focus';
  readonly sequence: number;
}

export interface AssignmentScope {
  readonly start: () => AssignmentStageToken | null;
  readonly advance: (stage: AssignmentStageToken) => AssignmentStageToken | null;
  readonly finish: (stage: AssignmentStageToken) => AssignmentFocusTicket | null;
  readonly isCurrent: (stage: AssignmentStageToken) => boolean;
  readonly isLive: () => boolean;
  readonly canRestoreFocus: (ticket: AssignmentFocusTicket) => boolean;
  readonly dispose: () => void;
}

export interface AssignmentLifetime {
  readonly activate: () => AssignmentScope;
}

export function createAssignmentLifetime(): AssignmentLifetime {
  let activeOwner: object | null = null;
  let currentStage: AssignmentStageToken | null = null;
  let focusTicket: AssignmentFocusTicket | null = null;
  let sequence = 0;

  return {
    activate() {
      const owner = {};
      activeOwner = owner;
      currentStage = null;
      focusTicket = null;
      const isLive = () => activeOwner === owner;
      const isCurrent = (stage: AssignmentStageToken) => isLive() && currentStage === stage;
      const start = (): AssignmentStageToken | null => {
        if (!isLive()) return null;
        const next: AssignmentStageToken = Object.freeze({
          kind: 'assignment-stage',
          sequence: ++sequence,
        });
        currentStage = next;
        focusTicket = null;
        return next;
      };

      return {
        start,
        isLive,
        isCurrent,
        advance(stage) {
          return isCurrent(stage) ? start() : null;
        },
        finish(stage) {
          if (!isCurrent(stage)) return null;
          currentStage = null;
          const ticket: AssignmentFocusTicket = Object.freeze({
            kind: 'assignment-focus',
            sequence: ++sequence,
          });
          focusTicket = ticket;
          return ticket;
        },
        canRestoreFocus(ticket) {
          return isLive() && currentStage === null && focusTicket === ticket;
        },
        dispose() {
          // Cleanup of scope A must never dispose a later scope B.
          if (!isLive()) return;
          activeOwner = null;
          currentStage = null;
          focusTicket = null;
        },
      };
    },
  };
}
