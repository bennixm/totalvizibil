import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const id = 'de100db0-3974-4f4a-afb3-0c72cc7939dd' // "Bug Repro Second Business"
await prisma.companyCategory.deleteMany({ where: { companyId: id } })
await prisma.companyLocation.deleteMany({ where: { companyId: id } })
await prisma.companyUser.deleteMany({ where: { companyId: id } })
await prisma.company.delete({ where: { id } }).catch((e) => console.log('company delete:', e.message))
console.log('done')
await prisma.$disconnect()
