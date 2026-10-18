import type { FastifyReply, FastifyRequest } from 'fastify';

export type HttpTerminalOutcome = 'response' | 'request_aborted' | 'connection_closed';
/** A disconnect is a delivery observation, never proof that a mutation rolled back. */
export function observeHttpTerminal(
  request: FastifyRequest,
  reply: FastifyReply,
  onTerminal: (outcome: HttpTerminalOutcome) => void,
): (outcome: HttpTerminalOutcome) => boolean {
  let ended = false;
  const finish = (outcome: HttpTerminalOutcome): boolean => {
    if (ended) return false;
    ended = true;
    request.raw.off('aborted', aborted);
    reply.raw.off('close', closed);
    try {
      onTerminal(outcome);
    } catch {
      /* Observation cannot change the request result. */
    }
    return true;
  };
  const aborted = () => {
    finish('request_aborted');
  };
  const closed = () => {
    if (!reply.raw.writableFinished) finish('connection_closed');
  };
  request.raw.once('aborted', aborted);
  reply.raw.once('close', closed);
  return finish;
}
