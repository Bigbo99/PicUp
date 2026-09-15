import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  configuredSuperAdminEmails,
  sessionSecret,
  validateRuntimeConfig
} from './runtime-config';

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe('runtime config', () => {
  it('uses the configured session secret', () => {
    process.env.JWT_SECRET = 'configured-secret';
    delete process.env.COOKIE_SECRET;
    assert.equal(sessionSecret(), 'configured-secret');
  });

  it('rejects a missing production secret', () => {
    process.env.APP_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.COOKIE_SECRET;
    assert.throws(() => validateRuntimeConfig(), /random value of at least 32 characters/);
  });

  it('rejects a non-HTTPS production public URL', () => {
    process.env.APP_ENV = 'production';
    process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef';
    process.env.WEB_PUBLIC_URL = 'http://example.com';
    assert.throws(() => validateRuntimeConfig(), /HTTPS URL/);
  });

  it('accepts valid production security settings', () => {
    process.env.APP_ENV = 'production';
    process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef';
    process.env.WEB_PUBLIC_URL = 'https://example.com';
    assert.doesNotThrow(() => validateRuntimeConfig());
  });

  it('normalizes the configured super-admin allowlist', () => {
    process.env.ADMIN_EMAILS = ' Admin@Example.com, second@example.com , ';
    assert.deepEqual(configuredSuperAdminEmails(), ['admin@example.com', 'second@example.com']);
  });
});
