import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()
const HASH_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }
const PASSWORD_HASH = await argon2.hash('Test1234!pass', HASH_OPTS)

const FIRST = ['Andrei','Maria','Ion','Elena','Mihai','Ana','Cristian','Ioana','Alexandru','Gabriela','Florin','Carmen','Radu','Diana','Vlad','Cosmina','Bogdan','Simona','Dan','Roxana','Stefan','Monica','Marius','Daniela','Catalin','Laura','Adrian','Oana','Razvan','Alina','Sorin','Georgiana','Lucian','Mihaela','Victor','Raluca','Cristi','Alexandra','Paul','Iulia']
const LAST = ['Popescu','Ionescu','Popa','Dumitru','Stan','Stoica','Gheorghe','Rusu','Matei','Constantin','Marin','Dinu','Toma','Barbu','Nistor','Pavel','Cojocaru','Ciobanu','Florea','Radu','Munteanu','Serban','Lazar','Petrescu','Ene']
const CITIES = [
  { city: 'București', county: 'București', lat: 44.4268, lng: 26.1025 },
  { city: 'Cluj-Napoca', county: 'Cluj', lat: 46.7712, lng: 23.6236 },
  { city: 'Timișoara', county: 'Timiș', lat: 45.7489, lng: 21.2087 },
  { city: 'Iași', county: 'Iași', lat: 47.1585, lng: 27.6014 },
  { city: 'Constanța', county: 'Constanța', lat: 44.1733, lng: 28.6383 },
  { city: 'Brașov', county: 'Brașov', lat: 45.6427, lng: 25.5887 },
  { city: 'Craiova', county: 'Dolj', lat: 44.3302, lng: 23.7949 },
  { city: 'Oradea', county: 'Bihor', lat: 47.0458, lng: 21.9182 },
  { city: 'Sibiu', county: 'Sibiu', lat: 45.7983, lng: 24.1256 },
  { city: 'Galați', county: 'Galați', lat: 45.4353, lng: 28.0080 },
]
const BIZ_WORDS = ['Pro','Expert','Plus','Star','Premium','Elite','Max','Prime','Smart','Gold']

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function rint(min, max) { return min + Math.floor(Math.random() * (max - min + 1)) }
function slugify(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') }

async function main() {
  const categories = await prisma.category.findMany({ where: { parentId: { not: null } } })
  if (!categories.length) throw new Error('No leaf categories found — seed categories first')

  console.log(`Seeding against ${categories.length} leaf categories...`)

  // --- 1. Users + wallets + billing profiles -------------------------------
  const USER_COUNT = 55
  const users = []
  for (let i = 0; i < USER_COUNT; i++) {
    const first = pick(FIRST)
    const last = pick(LAST)
    const email = `${slugify(first)}.${slugify(last)}${i}@example.com`
    users.push({ id: randomUUID(), email, name: `${first} ${last}`, passwordHash: PASSWORD_HASH, status: Math.random() < 0.06 ? 'suspended' : 'active' })
  }
  await prisma.user.createMany({ data: users, skipDuplicates: true })
  console.log(`Created ${users.length} users`)

  const wallets = users.map((u) => ({
    id: randomUUID(),
    userId: u.id,
    balanceMinor: rint(0, 80000),
    currency: Math.random() < 0.5 ? 'EUR' : 'RON',
  }))
  await prisma.wallet.createMany({ data: wallets, skipDuplicates: true })

  const billingProfiles = []
  for (let i = 0; i < users.length; i++) {
    if (Math.random() < 0.25) continue // some users never complete billing
    const u = users[i]
    const loc = pick(CITIES)
    const isCompany = Math.random() < 0.4
    billingProfiles.push({
      id: randomUUID(),
      userId: u.id,
      kind: isCompany ? 'company' : 'individual',
      name: isCompany ? `${pick(LAST)} ${pick(BIZ_WORDS)} SRL` : u.name,
      taxId: isCompany ? `RO${rint(10000000, 39999999)}` : null,
      regCom: isCompany ? `J${rint(10, 40)}/${rint(100, 9999)}/${rint(2015, 2026)}` : null,
      vatPayer: isCompany ? Math.random() < 0.6 : false,
      address: `Str. ${pick(LAST)} nr. ${rint(1, 150)}`,
      city: loc.city,
      county: loc.county,
      postalCode: String(rint(100000, 799999)),
      country: 'RO',
      billingEmail: u.email,
    })
  }
  await prisma.billingProfile.createMany({ data: billingProfiles, skipDuplicates: true })
  console.log(`Created ${billingProfiles.length} billing profiles`)

  // --- 2. Companies (varied status/plan/category/county) -------------------
  const COMPANY_COUNT = 42
  const companies = []
  for (let i = 0; i < COMPANY_COUNT; i++) {
    const owner = pick(users)
    const cat = pick(categories)
    const loc = pick(CITIES)
    const name = `${pick(LAST)} ${pick(BIZ_WORDS)}`
    const statusRoll = Math.random()
    const status = statusRoll < 0.08 ? 'suspended' : statusRoll < 0.3 ? 'draft' : 'active'
    const mode = Math.random() < 0.45 ? 'advanced' : 'easy'
    companies.push({
      id: randomUUID(),
      displayName: name,
      slug: `${slugify(name)}-${i}`,
      categoryId: cat.id,
      status,
      ownerUserId: owner.id,
      qualityScore: rint(0, 100),
      featured: status === 'active' && Math.random() < 0.15,
      advancedUnlockedAt: mode === 'advanced' ? new Date(Date.now() - rint(1, 300) * 86_400_000) : null,
      claimedAt: status !== 'draft' ? new Date(Date.now() - rint(1, 300) * 86_400_000) : null,
      createdAt: new Date(Date.now() - rint(1, 400) * 86_400_000),
      _cat: cat,
      _loc: loc,
      _mode: mode,
    })
  }
  for (const c of companies) {
    const { _cat, _loc, _mode, ...data } = c
    await prisma.company.create({ data })
    await prisma.companyUser.create({ data: { companyId: c.id, userId: c.ownerUserId, role: 'owner', status: 'active' } })
    await prisma.companyCategory.create({ data: { companyId: c.id, categoryId: _cat.id, isPrimary: true } })
    await prisma.companyLocation.create({
      data: { companyId: c.id, city: _loc.city, county: _loc.county, country: 'RO', lat: _loc.lat, lng: _loc.lng, isPrimary: true, nationwide: false },
    })
    await prisma.website.create({
      data: {
        companyId: c.id,
        mode: _mode,
        status: c.status === 'active' ? 'published' : 'draft',
        theme: { palette: 'indigo', fontPair: 'grotesk-inter', radius: 'rounded', density: 'comfortable' },
        content: { pages: [{ slug: 'home', title: 'Home', isHome: true, sections: [] }], seo: {} },
        generator: 'easy-template-v3:classic',
        publishedAt: _mode === 'easy' && c.status === 'active' ? new Date() : null,
      },
    })
  }
  console.log(`Created ${companies.length} companies (with website/category/location rows)`)

  // --- 3. Invoices: real counter, matching wallet transactions --------------
  const INVOICE_SERIES = 'TVZ'
  async function nextInvoiceNumber(tx) {
    const year = new Date().getFullYear()
    const existing = await tx.invoiceCounter.findUnique({ where: { series: INVOICE_SERIES } })
    let seq
    if (!existing || existing.year !== year) {
      await tx.invoiceCounter.upsert({
        where: { series: INVOICE_SERIES },
        create: { series: INVOICE_SERIES, year, nextSeq: 2 },
        update: { year, nextSeq: 2 },
      })
      seq = 1
    } else {
      const updated = await tx.invoiceCounter.update({ where: { series: INVOICE_SERIES }, data: { nextSeq: { increment: 1 } } })
      seq = updated.nextSeq - 1
    }
    return `${INVOICE_SERIES}-${year}-${String(seq).padStart(6, '0')}`
  }

  let invoiceCount = 0
  const eligibleUsers = users.filter((u) => billingProfiles.some((b) => b.userId === u.id))
  for (const u of eligibleUsers) {
    const profile = billingProfiles.find((b) => b.userId === u.id)
    const wallet = wallets.find((w) => w.userId === u.id)
    const n = rint(1, 4)
    for (let i = 0; i < n; i++) {
      const credits = pick([10, 25, 50, 100, 200])
      const eurCents = credits * 100
      const fxRate = 5.05
      const ronBani = Math.round(eurCents * fxRate)
      const totalMinor = profile.country === 'RO' ? ronBani : eurCents
      const vatRatePct = 0
      const subtotal = totalMinor
      const vat = 0
      const voided = Math.random() < 0.05
      await prisma.$transaction(async (tx) => {
        const number = await nextInvoiceNumber(tx)
        const txn = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'purchase',
            status: 'completed',
            amountMinor: credits * 100,
            balanceAfterMinor: wallet.balanceMinor,
            eurCents,
            ronBani,
            fxRate,
            provider: 'dev-mock',
            createdAt: new Date(Date.now() - rint(1, 300) * 86_400_000),
          },
        })
        await tx.invoice.create({
          data: {
            number,
            userId: u.id,
            walletTransactionId: txn.id,
            kind: 'topup',
            buyerKind: profile.kind,
            buyerName: profile.name,
            buyerTaxId: profile.taxId,
            buyerRegCom: profile.regCom,
            buyerVatPayer: profile.vatPayer,
            buyerAddress: profile.address,
            buyerCity: profile.city,
            buyerCounty: profile.county,
            buyerPostalCode: profile.postalCode,
            buyerCountry: profile.country,
            buyerEmail: profile.billingEmail,
            issuerName: 'Totalvizibil SRL',
            issuerAddress: 'Str. Exemplu nr. 1, București',
            currency: 'RON',
            description: `${credits} credite Totalvizibil`,
            subtotalMinor: subtotal,
            vatRatePct,
            vatMinor: vat,
            totalMinor,
            eurCents,
            fxRate,
            issuedAt: txn.createdAt,
            voidedAt: voided ? new Date() : null,
            voidReason: voided ? 'Solicitare client — plată duplicată' : null,
          },
        })
      })
      invoiceCount++
    }
  }
  console.log(`Created ${invoiceCount} invoices`)

  // --- 4. Support tickets ----------------------------------------------------
  const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
  const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent']
  const TICKET_CATEGORIES = ['bug', 'problem', 'question', 'billing', 'feedback', 'other']
  const SUBJECTS = [
    'Nu pot activa campania', 'Factura nu corespunde cu suma plătită', 'Site-ul nu se încarcă',
    'Vreau să schimb categoria afacerii', 'Credit dispărut din portofel', 'Nu primesc notificări pe email',
    'Builder-ul AI rămâne blocat', 'Cum schimb parola', 'Afacerea nu apare în feed', 'Rambursare neprocesată',
  ]
  const admin = await prisma.user.findUnique({ where: { email: 'radu.pop.qa1030@example.com' } })
  let ticketCount = 0
  for (let i = 0; i < 28; i++) {
    const requester = pick(users)
    const status = pick(TICKET_STATUSES)
    const hasAssignee = status !== 'open' && Math.random() < 0.8
    const created = new Date(Date.now() - rint(1, 60) * 86_400_000)
    const ticket = await prisma.supportTicket.create({
      data: {
        subject: pick(SUBJECTS),
        status,
        priority: pick(TICKET_PRIORITIES),
        category: pick(TICKET_CATEGORIES),
        requesterId: requester.id,
        assigneeId: hasAssignee ? admin.id : null,
        firstResponseAt: ['in_progress', 'waiting', 'resolved', 'closed'].includes(status) ? new Date(created.getTime() + 3_600_000) : null,
        resolvedAt: ['resolved', 'closed'].includes(status) ? new Date(created.getTime() + 86_400_000) : null,
        closedAt: status === 'closed' ? new Date(created.getTime() + 2 * 86_400_000) : null,
        createdAt: created,
        lastActivityAt: created,
      },
    })
    await prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: requester.id,
        kind: 'reply',
        body: 'Am întâmpinat o problemă și aș avea nevoie de ajutor, vă mulțumesc anticipat.',
        createdAt: created,
      },
    })
    ticketCount++
  }
  console.log(`Created ${ticketCount} support tickets`)

  // --- 5. Referrals ------------------------------------------------------
  let refCount = 0
  for (let i = 0; i < 18; i++) {
    const referrer = pick(users)
    const referred = users[(users.indexOf(referrer) + i + 1) % users.length]
    if (referrer.id === referred.id) continue
    const rewarded = Math.random() < 0.55
    try {
      await prisma.referral.create({
        data: {
          referrerId: referrer.id,
          referredUserId: referred.id,
          status: rewarded ? 'rewarded' : 'pending',
          rewardCredits: rewarded ? 25 : null,
          rewardedAt: rewarded ? new Date(Date.now() - rint(1, 90) * 86_400_000) : null,
          createdAt: new Date(Date.now() - rint(1, 120) * 86_400_000),
        },
      })
      refCount++
    } catch {
      // referredUserId must be unique — skip on collision
    }
  }
  console.log(`Created ${refCount} referrals`)

  // --- 6. Platform expenses ------------------------------------------------
  const EXP_CATEGORIES = ['hosting', 'call_center', 'cloud_storage', 'domains', 'google_ads', 'stripe_fees', 'other']
  const expenses = []
  for (let i = 0; i < 45; i++) {
    expenses.push({
      id: randomUUID(),
      category: pick(EXP_CATEGORIES),
      incurredOn: new Date(Date.now() - rint(1, 180) * 86_400_000),
      amountMinor: rint(500, 250000),
      currency: 'EUR',
      source: Math.random() < 0.3 ? 'stripe_api' : 'manual',
      note: Math.random() < 0.5 ? 'Cost lunar recurent' : null,
      createdById: admin.id,
    })
  }
  await prisma.platformExpense.createMany({ data: expenses, skipDuplicates: true })
  console.log(`Created ${expenses.length} platform expenses`)

  console.log('Done.')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
