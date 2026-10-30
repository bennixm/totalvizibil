import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const [users, companies, categories, platformSettings, invoiceCounter] = await Promise.all([
  prisma.user.count(),
  prisma.company.count(),
  prisma.category.count(),
  prisma.platformSetting.count().catch(() => 'n/a'),
  prisma.invoiceCounter.count().catch(() => 'n/a'),
])
console.log({ users, companies, categories, platformSettings, invoiceCounter })
await prisma.$disconnect()
