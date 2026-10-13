/** Migration 0050 reserves acc: handles for Account admission. They are not
 * credentials. Linking a code-based Seat to an Account preserves its code. */
export function classroomSeatAccess(loginHandle: string) {
  const accountOnly = loginHandle.startsWith('acc:');
  return {
    loginMethod: accountOnly ? ('account' as const) : ('student_code' as const),
    studentCode: accountOnly ? null : loginHandle,
    loginHandle: accountOnly ? null : loginHandle,
  };
}
