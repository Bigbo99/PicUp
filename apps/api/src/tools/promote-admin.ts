import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../common/env';

loadEnv();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Usage: pnpm --filter @picup/api admin:promote -- user@example.com');
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.isGuest || user.status !== 'active' || !user.emailVerifiedAt) {
      throw new Error('Only an existing active, verified, non-guest account can be promoted');
    }
    const promoted = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'admin', isGuest: false }
    });
    console.log(`Promoted ${promoted.email} (${promoted.id}) to admin`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
