export const DEFAULT_ALLOWED_COMMANDS = ['git', 'gh', 'npm', 'pytest'];

export function validCommandName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);
}
