export function isValidEmail(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 255
  );
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Workspace slug is only a tenant locator during authentication. */
export function isValidWorkspace(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(value.trim());
}
