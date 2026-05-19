import nodemailer from 'nodemailer';
import { loadEnv } from '../common/env';

loadEnv();

function envFlag(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const host = requireEnv('SMTP_HOST');
  const user = requireEnv('SMTP_USER');
  const pass = requireEnv('SMTP_PASS');
  const port = envNumber('SMTP_PORT', 587);
  const secure = envFlag('SMTP_SECURE', port === 465);
  const requireTLS = envFlag('SMTP_REQUIRE_TLS', port === 587 && !secure);
  const rejectUnauthorized = envFlag('SMTP_REJECT_UNAUTHORIZED', true);
  const authMethod = process.env.SMTP_AUTH_METHOD?.trim();
  const from = process.env.SMTP_FROM?.trim() || user;
  const to = process.argv[2]?.trim() || process.env.TEST_SMTP_TO?.trim() || user;
  const appName = process.env.APP_NAME?.trim() || 'PicUp';

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    auth: { user, pass },
    ...(authMethod ? { authMethod } : {}),
    connectionTimeout: envNumber('SMTP_CONNECTION_TIMEOUT_MS', 30000),
    greetingTimeout: envNumber('SMTP_GREETING_TIMEOUT_MS', 30000),
    socketTimeout: envNumber('SMTP_SOCKET_TIMEOUT_MS', 60000),
    tls: { rejectUnauthorized }
  });

  console.log(`Connecting to SMTP ${host}:${port} as ${user}...`);
  await transporter.verify();
  console.log('SMTP login verified. Sending test email...');

  const result = await transporter.sendMail({
    from,
    to,
    subject: `${appName} SMTP test`,
    text: `This is a PicUp SMTP test email.\n\nHost: ${host}\nPort: ${port}\nTLS: ${requireTLS || secure}`
  });

  console.log(`Test email sent to ${to}. Message id: ${result.messageId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
