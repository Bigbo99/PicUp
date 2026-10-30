import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import type { PrismaService } from '../../common/database/prisma.service';
import { StorageService } from '../../common/storage.service';
import { AuthService } from './auth.service';
import { AdminController } from '../admin/admin.controller';

function fixture() {
  const row = {
    id: randomUUID(), email: 'review@example.test', displayName: 'Original', role: 'user' as const,
    status: 'active', isGuest: false, quotaUnlimited: false, creditBalance: 10,
    passwordHash: 'private-password-hash', emailVerifiedAt: new Date(),
    lastIp: null, lastCountry: null, lastRegion: null, lastCity: null, lastSeenAt: null,
    createdAt: new Date(), updatedAt: new Date()
  };
  const logs: { before: unknown; after: unknown }[] = [];
  let beforeWrite = () => {};
  let challenge: Record<string, unknown>;
  let code = '';
  const db = {
    user: {
      findUnique: async () => ({ ...row }),
      update: async ({ where, data }: { where: { status?: string }; data: object }) => {
        beforeWrite();
        if (where.status && row.status !== where.status) throw new Error('Account no longer active');
        Object.assign(row, data);
        return { ...row };
      }
    },
    imageJob: { count: async () => 0 },
    auditLog: { create: async ({ data }: { data: { before: unknown; after: unknown } }) => { logs.push(data); return data; } },
    emailAuthChallenge: {
      create: async ({ data }: { data: object }) => {
        challenge = { ...data, id: randomUUID(), consumedAt: null, attempts: 0 };
        return challenge;
      },
      findUnique: async () => challenge,
      update: async ({ data }: { data: object }) => Object.assign(challenge, data)
    }
  };
  const storage = new StorageService(db as unknown as PrismaService);
  const auth = new AuthService(storage, db as unknown as PrismaService);
  const internal = auth as unknown as {
    requireUser(): Promise<unknown>;
    createSession(): Promise<string>;
    deliverEmailCode(email: string, code: string): Promise<boolean>;
  };
  internal.requireUser = async () => auth.toPublicUser((await storage.getUserById(row.id))!);
  internal.createSession = async () => 'test-session';
  internal.deliverEmailCode = async (_email, value) => { code = value; return true; };
  return { row, db, auth, storage, logs, beforeWrite: (fn: () => void) => { beforeWrite = fn; }, code: () => code };
}

it('nickname saves preserve a concurrent debit and do not write account permissions', async () => {
  const test = fixture();
  test.beforeWrite(() => { test.row.creditBalance--; test.row.quotaUnlimited = true; });
  await test.auth.updateProfile({} as never, { displayName: 'Changed' }, {} as never);
  assert.equal(test.row.creditBalance, 9);
  assert.equal(test.row.quotaUnlimited, true);
  assert.equal(test.row.displayName, 'Changed');
});

it('partial profile updates preserve omitted fields and clear verification on email change', async () => {
  const test = fixture();
  await test.auth.updateProfile({} as never, {}, {} as never);
  assert.equal(test.row.displayName, 'Original');
  test.storage.getUserByEmail = async () => null;
  await test.auth.updateProfile({} as never, { email: 'changed@example.test' }, {} as never);
  assert.equal(test.row.emailVerifiedAt, null);
});

it('a profile save cannot reactivate an account disabled after it was read', async () => {
  const test = fixture();
  test.beforeWrite(() => { test.row.status = 'disabled'; });
  await assert.rejects(test.auth.updateProfile({} as never, { displayName: 'Changed' }, {} as never));
  assert.equal(test.row.status, 'disabled');
});

it('legacy registration cannot create a verified account without a code', async () => {
  await assert.rejects(fixture().auth.register({
    email: 'unverified@example.test', password: 'test-password-123', termsAccepted: true
  }, {} as never), /验证码/);
});

it('disabled accounts cannot request registration or redeem an earlier registration code', async () => {
  const test = fixture();
  test.row.status = 'disabled';
  await assert.rejects(test.auth.startEmailAuth({ email: test.row.email, mode: 'register', password: 'test-password-123', termsAccepted: true }), /联系管理员/);
  test.row.status = 'active';
  test.row.isGuest = true;
  const challenge = await test.auth.startEmailAuth({ email: test.row.email, mode: 'register', password: 'test-password-123', termsAccepted: true });
  test.row.status = 'disabled';
  await assert.rejects(test.auth.verifyEmailAuth({ challengeId: challenge.challengeId, code: test.code() }, {} as never), /联系管理员/);
  assert.equal(test.row.status, 'disabled');
});

it('editing user status revokes sessions and excludes password hashes from audit writes', async () => {
  const test = fixture();
  let revocations = 0;
  test.auth.revokeAllSessionsForUser = async () => { revocations++; };
  const controller = new AdminController(test.storage, test.auth, null as never, null as never, null as never);
  await controller.updateUser(test.row.id, { status: 'disabled' }, {
    authUser: { id: randomUUID(), email: 'admin@example.test', role: 'admin' }, headers: {}, socket: {}
  } as never);
  assert.equal(revocations, 1);
  assert.equal(JSON.stringify(test.logs).includes('private-password-hash'), false);
  assert.equal((test.logs[0].before as { displayName: string }).displayName, 'Original');
});
