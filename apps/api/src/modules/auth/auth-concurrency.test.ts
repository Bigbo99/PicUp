import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PrismaService } from '../../common/database/prisma.service';
import { StorageService } from '../../common/storage.service';
import { AuthService } from './auth.service';

describe('account changes with a real database', { skip: !process.env.TEST_DATABASE_URL }, () => {
  const prisma = new PrismaService({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const storage = new StorageService(prisma);
  const ids: string[] = [];
  before(() => prisma.$connect());
  after(async () => {
    await prisma.auditLog.deleteMany({ where: { target: { in: ids.map(id => `users:${id}`) } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });
  async function fixture() {
    const row = await prisma.user.create({ data: {
      email: `${randomUUID()}@example.test`, isGuest: false, status: 'active', creditBalance: 10
    } });
    ids.push(row.id);
    const auth = new AuthService(storage, prisma);
    let code = '';
    const internal = auth as any;
    internal.requireUser = async () => storage.getUserById(row.id);
    internal.deliverEmailCode = async (_email: string, value: string) => { code = value; return true; };
    const res = { cookie() {} } as never;
    return { row, auth, code: () => code, res };
  }

  it('concurrent debits cannot overdraw the balance', async () => {
    const { row } = await fixture();
    const results = await Promise.all(Array.from({ length: 12 }, () => storage.adjustUserCredits(row.id, -8)));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await storage.getUserById(row.id))!.creditBalance, 2);
  });

  it('only one concurrent login can consume a code', async () => {
    const { row, auth, code, res } = await fixture();
    const challenge = await auth.startEmailAuth({ email: row.email!, mode: 'login' });
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => auth.verifyEmailAuth({
      challengeId: challenge.challengeId, code: code()
    }, res)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  });

  it('concurrent wrong codes cannot exceed five attempts or allow later reuse', async () => {
    const { row, auth, code, res } = await fixture();
    const challenge = await auth.startEmailAuth({ email: row.email!, mode: 'login' });
    await Promise.allSettled(Array.from({ length: 12 }, () => auth.verifyEmailAuth({ challengeId: challenge.challengeId, code: 'wrong' }, res)));
    assert.equal((await prisma.emailAuthChallenge.findUniqueOrThrow({ where: { id: challenge.challengeId } })).attempts, 5);
    await assert.rejects(auth.verifyEmailAuth({ challengeId: challenge.challengeId, code: code() }, res));
  });

  it('email changes require a code bound to the account, email and purpose', async () => {
    const first = await fixture();
    const second = await fixture();
    const email = `${randomUUID()}@example.test`;
    const challenge = await first.auth.startProfileEmailChange({} as never, { email });
    const input = { email, emailChallengeId: challenge.challengeId, emailCode: first.code() };
    await assert.rejects(second.auth.updateProfile({} as never, input, second.res));
    await assert.rejects(first.auth.updateProfile({} as never, { ...input, email: `${randomUUID()}@example.test` }, first.res));
    await assert.rejects(first.auth.verifyEmailAuth({ challengeId: challenge.challengeId, code: first.code() }, first.res));
    await assert.rejects(first.auth.updateProfile({} as never, { email }, first.res));
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => first.auth.updateProfile({} as never, input, first.res)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const saved = await storage.getUserById(first.row.id);
    assert.equal(saved!.email, email);
    assert.ok(saved!.emailVerifiedAt);
    assert.equal(saved!.creditBalance, 10);
  });

  it('expired email codes cannot change the account', async () => {
    const { row, auth, code, res } = await fixture();
    const email = `${randomUUID()}@example.test`;
    const challenge = await auth.startProfileEmailChange({} as never, { email });
    await prisma.emailAuthChallenge.update({ where: { id: challenge.challengeId }, data: { expiresAt: new Date(0) } });
    await assert.rejects(auth.updateProfile({} as never, { email, emailChallengeId: challenge.challengeId, emailCode: code() }, res));
    assert.equal((await storage.getUserById(row.id))!.email, row.email);
  });

  it('duplicate admin emails return a useful conflict and leave the user unchanged', async () => {
    const first = await fixture();
    const second = await fixture();
    await assert.rejects(storage.updateUserAdmin(first.row.id, { email: second.row.email! }), (error: any) => {
      assert.equal(error.getStatus(), 409);
      assert.match(error.message, /邮箱已被使用/);
      return true;
    });
    assert.equal((await storage.getUserById(first.row.id))!.email, first.row.email);
  });
});
