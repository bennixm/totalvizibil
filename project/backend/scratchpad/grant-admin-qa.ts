// One-off, narrowly-scoped helper for local UI QA: grants the 'admin'
// platform role to a single throwaway account by email. Touches only that
// one user's row — never run against a real account.
import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error('usage: ts-node grant-admin-qa.ts <email>');
  const prisma = new PrismaClient();
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.platformRoleAssignment.upsert({
    where: { userId_role: { userId: user.id, role: 'admin' } },
    update: {},
    create: { userId: user.id, role: 'admin' },
  });
  console.log('granted admin to', email);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
