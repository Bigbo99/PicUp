import 'reflect-metadata';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { redactAuditValue } from './audit-redaction';
import { StorageService } from './storage.service';

it('removes nested credentials without changing the source or useful audit data', () => {
  const input = { displayName: 'Example', passwordHash: 'hash', nested: [{ api_key: 'secret', balance: 3 }], empty: null };
  assert.deepEqual(redactAuditValue(input), { displayName: 'Example', nested: [{ balance: 3 }], empty: null });
  assert.equal(input.passwordHash, 'hash');
});

it('redacts historical audit records in both listing endpoints', async () => {
  const log = { id: 'log', before: { passwordHash: 'historical-secret', creditBalance: 5 }, after: null, createdAt: new Date() };
  const storage = new StorageService({ auditLog: { findMany: async () => [log] } } as never);
  for (const result of [await storage.listAuditLogs(), await storage.listAuditLogsFiltered()]) {
    assert.equal(JSON.stringify(result).includes('historical-secret'), false);
    assert.equal(JSON.stringify(result).includes('creditBalance'), true);
  }
});
