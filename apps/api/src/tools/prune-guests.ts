import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../common/env';

loadEnv();

// Deletes guest accounts that never stored anything. Dry run by default.
async function main() {
  const apply = process.argv.includes('--apply');
  const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : 7;
  if (!Number.isInteger(days) || days < 1) {
    throw new Error('Usage: pnpm --filter @picup/api guests:prune -- [--days=7] [--apply]');
  }

  const prisma = new PrismaClient();
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Same emptiness rules as StorageService.transferGuestFiles; skip anyone seen within the window.
    const candidates = await prisma.user.findMany({
      where: {
        isGuest: true, role: 'guest', creditBalance: 0, email: null, passwordHash: null,
        createdAt: { lt: cutoff },
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
        files: { none: {} }, subjects: { none: {} }, jobs: { none: {} },
        auditLogs: { none: {} }, identities: { none: {} },
        emailChallenges: { none: {} }, wechatSessions: { none: {} },
        studioPreference: null, assetMetadata: { none: {} }, conversationMetadata: { none: {} }
      },
      select: { id: true }
    });
    const ids = candidates.map((user) => user.id);
    const [paid, credited] = await Promise.all([
      prisma.paymentOrder.findMany({ where: { userId: { in: ids } }, select: { userId: true } }),
      prisma.creditEntry.findMany({ where: { userId: { in: ids } }, select: { userId: true } })
    ]);
    const keep = new Set([...paid, ...credited].map((row) => row.userId));
    const removable = ids.filter((id) => !keep.has(id));
    const totalGuests = await prisma.user.count({ where: { isGuest: true } });

    console.log(`Guests: ${totalGuests}. Empty and idle for ${days}+ days: ${removable.length}.`);
    if (!apply) {
      console.log('Dry run. Re-run with --apply to delete them.');
      return;
    }
    let deleted = 0;
    for (let index = 0; index < removable.length; index += 500) {
      const batch = removable.slice(index, index + 500);
      // Re-check emptiness at delete time in case a guest became active meanwhile.
      const result = await prisma.user.deleteMany({ where: {
        id: { in: batch }, isGuest: true, creditBalance: 0,
        files: { none: {} }, subjects: { none: {} }, jobs: { none: {} },
        identities: { none: {} }, studioPreference: null,
        assetMetadata: { none: {} }, conversationMetadata: { none: {} }
      } });
      deleted += result.count;
    }
    console.log(`Deleted ${deleted} empty guest accounts.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
