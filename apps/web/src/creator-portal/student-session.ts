import type { ClassroomStudentSession, SessionPayload } from '../api';

/**
 * A class seat described in the same terms as an account.
 *
 * The portal is one product: the same header, the same sidebar, the same
 * project pages and the same editors for everyone. A learner is not given a
 * smaller copy of it — they are given the same one, with the parts they have no
 * business in absent. So a seat is presented to the shell exactly as an account
 * is, and the difference lives where every other difference already lives: in
 * capabilities.
 *
 * A seat holds none. That is what removes class management, school switching
 * and account settings, without a single branch inside the pages themselves.
 */
export function studentSessionPayload(seat: ClassroomStudentSession): SessionPayload {
  const person = {
    id: seat.student.seatId,
    displayName: seat.student.displayName,
    // A seat has no address. Nothing in the portal writes to one; the field
    // exists because an account has it.
    email: '',
  };
  return {
    authenticated: true,
    user: person,
    account: person,
    capabilities: [],
    workspaces: [
      {
        workspaceId: seat.classroom.id,
        kind: 'organization',
        title: seat.classroom.title,
        role: 'student',
      },
    ],
    activeWorkspace: { workspaceId: seat.classroom.id, kind: 'organization' },
    navigation: { classes: false, classroomManagement: false },
  };
}
