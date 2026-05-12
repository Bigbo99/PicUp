
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const files = await prisma.fileRecord.findMany({ take: 5 });
    console.log('File URLs in database:');
    files.forEach(f => console.log(`- ${f.url}`));

    const jobs = await prisma.imageJob.findMany({ 
      where: { status: 'succeeded' },
      take: 5 
    });
    console.log('\nOutput images in jobs:');
    jobs.forEach(j => {
      console.log(`- Job ${j.id}: ${JSON.stringify(j.outputImages)}`);
    });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
