import type { JoinCodeSecretPort } from '@asa-lab/classroom';

/**
 * Server-side secret behind class-code digests and join-intent tokens.
 *
 * Absence is reported, never papered over: digesting with an empty key would
 * make every stored digest reproducible from the database alone, and signing
 * intents with one would let anybody mint them. The class-code subsystem
 * answers "unavailable" instead, which the interface explains honestly.
 */
export class EnvJoinCodeSecret implements JoinCodeSecretPort {
  secret(): string | null {
    const value = process.env['ASA_JOIN_CODE_PEPPER'];
    return typeof value === 'string' && value.length >= 32 ? value : null;
  }
}
