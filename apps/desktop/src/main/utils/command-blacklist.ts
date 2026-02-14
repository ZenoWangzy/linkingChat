const DANGEROUS_PATTERNS: RegExp[] = [
  /^rm\s+(-rf?|--recursive)\s+\//,
  /^rm\s+-rf?\s+~/,
  /^format\s/i,
  /^mkfs\./,
  /^dd\s+if=/,
  /^:\(\)\{.*\|.*&\s*\}\s*;/,
  /shutdown|reboot|halt|poweroff/i,
  /^chmod\s+(-R\s+)?777\s+\//,
  /^chown\s+(-R\s+)?.*\s+\//,
  /^del\s+\/s\s+\/q\s+[a-z]:\\/i,
  /^rd\s+\/s\s+\/q\s+[a-z]:\\/i,
];

export function isDangerousCommand(action: string): boolean {
  const trimmed = action.trim();
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(trimmed));
}
