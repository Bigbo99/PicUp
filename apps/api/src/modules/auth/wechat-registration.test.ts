import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { PrismaService } from '../../common/database/prisma.service';
import { StorageService } from '../../common/storage.service';
import { AuthService } from './auth.service';

describe('WeChat registration', { skip: !process.env.TEST_DATABASE_URL }, () => {
  const db = new PrismaService({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const storage = new StorageService(db);
  const auth = new AuthService(storage, db);
  const ids: string[] = [];
  // Exercise the real registration transaction while replacing the remote middleware.
  const internal = auth as unknown as {
    syncWechatFirstLogin(payload: { openid: string }, req?: unknown): Promise<string>;
    requestWxmid(): Promise<unknown>;
    setSessionCookie(res: unknown, user: unknown): void;
    consumeConfirmedWechatSession(id: string, state: string, res: unknown): Promise<{ user?: { isGuest: boolean; role: string } }>;
  };
  let failSync = false;
  internal.requestWxmid = async () => { if (failSync) throw new Error('middleware offline'); return {}; };
  after(async () => {
    await db.fileRecord.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });
  async function guestRequest() {
    const guest = await db.user.create({ data: {} });
    ids.push(guest.id);
    let cookie = '';
    internal.setSessionCookie({ cookie: (_name: string, value: string) => { cookie = value; } }, guest);
    return { guest, req: { headers: { cookie: `picup_session=${cookie}` }, socket: {} } };
  }
  it('upgrades the guest in place and preserves uploaded files', async () => {
    const { guest, req } = await guestRequest();
    const file = await db.fileRecord.create({ data: { userId: guest.id, url: '/test.png', mimeType: 'image/png', size: 1 } });
    const id = await internal.syncWechatFirstLogin({ openid: randomUUID() }, req);
    assert.equal(id, guest.id);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id } })).isGuest, false);
    assert.equal((await db.fileRecord.findUniqueOrThrow({ where: { id: file.id } })).userId, id);
  });
  it('deduplicates concurrent first scans of the same WeChat identity', async () => {
    const openid = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => internal.syncWechatFirstLogin({ openid })));
    ids.push(...new Set(results));
    assert.equal(new Set(results).size, 1);
    assert.equal(await db.externalIdentity.count({ where: { providerUserId: openid } }), 1);
  });
  it('retries a failed middleware sync without creating another account', async () => {
    const { guest, req } = await guestRequest();
    const openid = randomUUID();
    failSync = true;
    await assert.rejects(internal.syncWechatFirstLogin({ openid }, req), /middleware offline/);
    failSync = false;
    assert.equal(await internal.syncWechatFirstLogin({ openid }, req), guest.id);
  });
  it('removes an empty guest after login but preserves guests with account data', async () => {
    const owner = await db.user.create({ data: { isGuest: false, role: 'user' } });
    ids.push(owner.id);
    const { guest } = await guestRequest();
    await storage.transferGuestFiles(guest.id, owner.id);
    assert.equal(await db.user.findUnique({ where: { id: guest.id } }), null);
    const { guest: retained } = await guestRequest();
    await db.user.update({ where: { id: retained.id }, data: { creditBalance: 1 } });
    await storage.transferGuestFiles(retained.id, owner.id);
    assert.ok(await db.user.findUnique({ where: { id: retained.id } }));
  });
  it('repairs a previously bound guest before returning a successful login', async () => {
    const { guest } = await guestRequest();
    const state = randomUUID();
    await db.wechatLoginSession.create({ data: { state, userId: guest.id, qrCodeUrl: 'test', status: 'confirmed', expiresAt: new Date(Date.now() + 60000) } });
    const result = await internal.consumeConfirmedWechatSession(guest.id, state, { cookie() {} });
    assert.equal(result.user?.isGuest, false);
    assert.equal(result.user?.role, 'user');
    await db.wechatLoginSession.delete({ where: { state } });
  });
});
