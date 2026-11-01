import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const EASY_PRODUCES = new Set([
  'hero', 'services', 'contact', 'about', 'stats', 'process',
  'features', 'gallery', 'testimonials', 'faq', 'cta',
])

async function main() {
  const websites = await prisma.website.findMany({
    select: { companyId: true, mode: true, publishedAt: true, content: true },
  })
  console.log(`Scanning ${websites.length} website rows...`)

  const offenders = []
  let totalSectionRows = 0
  const typeCounts = new Map()

  for (const w of websites) {
    const content = w.content
    const pages = content && typeof content === 'object' ? content.pages : null
    if (!Array.isArray(pages)) continue
    const extraTypes = new Set()
    for (const page of pages) {
      const sections = Array.isArray(page?.sections) ? page.sections : []
      for (const s of sections) {
        if (!s || typeof s.type !== 'string') continue
        totalSectionRows++
        typeCounts.set(s.type, (typeCounts.get(s.type) ?? 0) + 1)
        if (!EASY_PRODUCES.has(s.type)) extraTypes.add(s.type)
      }
    }
    if (extraTypes.size) {
      offenders.push({
        companyId: w.companyId,
        mode: w.mode,
        publishedAt: w.publishedAt,
        extraTypes: [...extraTypes],
      })
    }
  }

  console.log(`\nTotal section rows scanned: ${totalSectionRows}`)
  console.log('\nAll section types actually present in the DB, with counts:')
  for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(16)} ${count}${EASY_PRODUCES.has(type) ? '' : '  <- NOT produced by Easy'}`)
  }

  console.log(`\nCompanies using a non-Easy section type: ${offenders.length}`)
  for (const o of offenders) {
    console.log(`  company=${o.companyId} mode=${o.mode} publishedAt=${o.publishedAt} types=${o.extraTypes.join(',')}`)
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
