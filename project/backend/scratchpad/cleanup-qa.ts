// Removes the throwaway QA account created for redesign screenshot testing.
import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error('usage: ts-node cleanup-qa.ts <email>');
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log('no such user, nothing to do');
    return;
  }
  await prisma.user.delete({ where: { email } });
  console.log('deleted', email);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
