import type { JoinCodePepperPort } from '@asa-lab/classroom';

/**
 * Server-side pepper for class-code digests.
 *
 * Absence is reported, never papered over: digesting with an empty key would
 * make every stored digest reproducible from the database alone, so the class
 * code feature answers "unavailable" instead.
 */
export class EnvJoinCodePepper implements JoinCodePepperPort {
  pepper(): string | null {
    const value = process.env['ASA_JOIN_CODE_PEPPER'];
    return typeof value === 'string' && value.length >= 32 ? value : null;
  }
}
