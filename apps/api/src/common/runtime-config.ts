const insecureSecrets = new Set([
  'change-me',
  'replace_me',
  'replace_with_random_secret',
  'picup-dev-secret'
]);

function configuredSecret() {
  return process.env.JWT_SECRET?.trim() || process.env.COOKIE_SECRET?.trim() || '';
}

export function sessionSecret() {
  const secret = configuredSecret();
  if (secret) return secret;
  if (process.env.APP_ENV === 'production') {
    throw new Error('JWT_SECRET or COOKIE_SECRET must be configured in production');
  }
  return 'picup-dev-secret';
}

export function validateRuntimeConfig() {
  if (process.env.APP_ENV !== 'production') return;

  const secret = configuredSecret();
  if (secret.length < 32 || insecureSecrets.has(secret.toLowerCase())) {
    throw new Error('JWT_SECRET or COOKIE_SECRET must be a random value of at least 32 characters in production');
  }

  const publicUrl = process.env.WEB_PUBLIC_URL?.trim();
  if (!publicUrl || !publicUrl.startsWith('https://')) {
    throw new Error('WEB_PUBLIC_URL must be an HTTPS URL in production');
  }
}

export function configuredSuperAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? process.env.SUPER_ADMIN_EMAILS ?? process.env.SUPER_ADMIN_EMAIL ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}
