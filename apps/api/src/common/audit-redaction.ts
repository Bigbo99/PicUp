const sensitiveKeys = new Set([
  'password', 'passwordhash', 'codehash', 'apikey', 'secret', 'token', 'accesstoken', 'refreshtoken'
]);

/** Apply on both write and read so older audit records are safe to display. */
export function redactAuditValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactAuditValue) as T;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !sensitiveKeys.has(key.replace(/_/g, '').toLowerCase()))
    .map(([key, entry]) => [key, redactAuditValue(entry)])) as T;
}
