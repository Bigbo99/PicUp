import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthService } from './auth.service';
import type { PrismaService } from '../../common/database/prisma.service';
import type { StorageService } from '../../common/storage.service';
import type { AuthenticatedRequest } from './auth.types';

function fixture(guest = false, bound = true) {
  const user = { id: 'user-a', isGuest: guest };
  const identity = { id: 'identity-a', profile: { profileGrantId: 'grant-a', avatarUrl: 'old' } as Record<string, unknown> };
  let writes = 0;
  let result: Record<string, unknown> = { status: 'pending' };
  const db = {
    externalIdentity: {
      findFirst: async () => bound ? identity : null,
      findUnique: async () => identity,
      findUniqueOrThrow: async () => identity,
      update: async ({ data }: { data: { profile: Record<string, unknown> } }) => { identity.profile = data.profile; },
    },
    user: { update: async () => { writes++; } },
    $queryRaw: async () => [],
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
  };
  const auth = new AuthService({} as StorageService, db as unknown as PrismaService);
  const internal = auth as unknown as { requireUser: () => Promise<unknown>; requestWxmid: (path: string, init?: RequestInit) => Promise<unknown> };
  internal.requireUser = async () => user;
  internal.requestWxmid = async () => result;
  return { auth, identity, writes: () => writes, result: (next: Record<string, unknown>) => { result = next; } };
}

describe('WeChat profile synchronization', () => {
  const request = {} as AuthenticatedRequest;
  it('rejects guests and accounts without WeChat binding', async () => {
    await assert.rejects(fixture(true).auth.authorizeWechatProfile(request), /请先登录/);
    await assert.rejects(fixture(false, false).auth.authorizeWechatProfile(request), /未绑定微信/);
  });
  it('does not change the account while authorization is pending or declined', async () => {
    const test = fixture();
    assert.deepEqual(await test.auth.syncWechatProfile(request), { status: 'pending' });
    test.result({ status: 'declined' });
    assert.deepEqual(await test.auth.syncWechatProfile(request), { status: 'declined' });
    assert.equal(test.writes(), 0);
  });
  it('applies profile once and preserves unrelated identity data', async () => {
    const test = fixture();
    test.result({ status: 'succeeded', nickname: 'Example', avatar: 'https://example.com/avatar.png' });
    assert.deepEqual(await test.auth.syncWechatProfile(request), { status: 'succeeded' });
    assert.equal(test.identity.profile.avatarUrl, 'https://example.com/avatar.png');
    assert.deepEqual(await test.auth.syncWechatProfile(request), { status: 'idle' });
    assert.equal(test.writes(), 1);
  });
  it('does not overwrite profile when middleware result is malformed', async () => {
    const test = fixture();
    test.result({ status: 'succeeded', nickname: null });
    await assert.rejects(test.auth.syncWechatProfile(request), /暂不可用/);
    assert.equal(test.writes(), 0);
  });
});
