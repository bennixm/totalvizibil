# Scalability Audit — Totalvizibil

**Data:** 2026-09-22
**Metodă:** analiză directă a codului (backend NestJS + Prisma/Postgres, frontend Vue), fără presupuneri — fiecare afirmație de mai jos e ancorată într-un fișier:linie concret. Niciun cod nu a fost modificat pentru acest raport.
**Întrebare de fond:** cât de bine rezistă platforma la 10.000+ utilizatori activi simultan, și ce s-ar rupe primul.

Acest document înlocuiește versiunea anterioară (generică, aspirațională, menționa funcționalități care nu există — „Voice sessions”, „Avatar sessions”, „Google Ads volume”) cu constatări reale din implementare.

---

## 0. Linia de bază arhitecturală (fapte confirmate)

- **Un singur proces NestJS**, pornit `pm2 start dist/main.js` (fără flag `-i`/cluster mode), pe **un singur VPS**, deploy prin SSH (`.github/workflows/deploy.yml`, job `deploy`, `concurrency: { group: deploy-vps, cancel-in-progress: false }`).
- **Niciun Dockerfile** în repo (verificat: `project/backend`, `project/frontend`, rădăcina repo). `project/docker-compose.yml` definește doar un container Postgres de dezvoltare — nu containerizează aplicația.
- **Niciun Redis**, nicio librărie de queue (Bull/BullMQ), niciun `@nestjs/schedule` în `package.json`. „Cron”-urile din aplicație sunt `setInterval()` scrise manual.
- **Niciun load balancer** — un VPS, un proces PM2, deploy direct pe el.
- Prisma: `PrismaService extends PrismaClient` fără niciun argument de constructor (`src/prisma/prisma.service.ts`, 13 linii) — fără `connection_limit`, fără `pool_timeout`, fără override de `datasources.db.url`. Pool implicit Prisma: `num_cpus_fizici × 2 + 1` conexiuni, nedimensionat explicit nicăieri.
- Rate limiting: `@nestjs/throttler`, `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])` (`app.module.ts:31`), guard global (`app.module.ts:54`). Fără `ThrottlerStorage` custom → store implicit **în memorie**, cheie implicită = IP.
- WebSocket: `@WebSocketGateway({ cors: { origin: true, credentials: true } })` (`notifications.gateway.ts:33-35`) — server Socket.IO implicit, fără adapter Redis, fără opțiuni custom (`maxHttpBufferSize`, `pingTimeout` etc.).
- Validare mediu la pornire (`src/config/env.ts`, `scripts/ensure-env.js`): **doar `DATABASE_URL` oprește pornirea** în producție dacă lipsește. Orice altă variabilă (Stripe, SMTP, Anthropic/DeepSeek, `FRONTEND_ORIGIN`) cade silențios pe un fallback gol sau pe `localhost:5173`, inclusiv în producție.
- Bani: peste tot întregi în unități minore (`Wallet.balanceMinor: Int`, `WalletTransaction.amountMinor: Int`, `Invoice.*Minor: Int`, `Campaign.*Minor: Int`), confirmate în `src/wallet/money.ts`. Zero float pentru sume monetare persistate.
- Upload-uri: stocate ca `Bytes` **direct în Postgres** (`WebsiteAsset.bytes`, `WebsiteBundleFile.bytes`) — nu pe disc, nu S3/GCS (confirmat: zero dependențe cloud storage în `package.json`, zero `multer`/`ServeStaticModule`).

---

## 1. Baza de date (schema, indexuri, conexiuni)

### 1.1 Indexuri bine acoperite
- `Company`: `slug` unic, `@@index([ownerUserId])`, `@@index([categoryId])`, `@@index([status])` — **dar niciun index compus `(status, categoryId)`**, exact perechea de filtre folosită de Feed.
- `WalletTransaction`: `@@unique([walletId, companyId, provider, spendDay])`, `@@index([walletId, createdAt])`, `@@index([companyId])`, `@@index([status, processAt])` — bine acoperit.
- `Lead`: `@@unique([companyId, visitorHash])`, `@@index([companyId, status, createdAt])`, `@@index([companyId, channel])` — se potrivește exact formei query-urilor din `leads.service.ts`.
- `AiUsageRecord`, `Session`, `PasswordResetToken`, `CompanyUser`, `CompanyLocation`, `CompanyContact`, `CompanyService`, `Referral`, `Invoice`, `ProV2Message`, `WebsiteAsset` — toate au index pe fiecare coloană FK folosită într-un `where`.

### 1.2 Coloane FK neindexate
- `SupportTicket.companyId` — **fără index** (spre deosebire de `requesterId`/`assigneeId`, indexate pe același model). Orice query „tichete pentru compania X” face scanare secvențială.
- `SupportMessage.authorId` — fără index (doar `ticketId` e indexat).
- `Category.parentId` — fără index. Risc mic dat fiind taxonomia mică/plafonată la 2 niveluri (vezi §7).

### 1.3 Câmpuri filtrate des, fără niciun index
- `User.status` — folosit de `NotificationsService.notifyAll()` (`notifications.service.ts:107-108`) pe un `findMany` **nepaginat** peste tot tabelul de utilizatori.
- `CompanyLocation.city` — filtrul de fallback din Feed folosește `contains`/`insensitive` (`feed.service.ts:214-221,349`), ceea ce un index btree simplu nu ar accelera oricum (ar trebui `pg_trgm`/GIN) — dar în prezent nu există niciun index, nici măcar unul parțial util.
- `Campaign.spendDay` și `Campaign.depletedNotifiedForDay` — neindexate; doar `status` e indexat. `sweepDepletedCampaigns()` filtrează pe toate trei (`notifications-sweep.service.ts:51-56`).
- `WebsiteDraft.expiresAt` — neindexat (dar nu am găsit niciun sweep care să interogheze după expirare).

### 1.4 Conexiuni / pool
- Nicio configurare de `connection_limit`/`pool_timeout` nicăieri în repo (verificat cu grep pe tot repo-ul).
- Niciun PgBouncer, niciun Prisma Accelerate/Data Proxy, niciun pooler extern — confirmat prin `docker-compose.yml` (doar Postgres brut) și grep pe tot repo-ul.
- Cu un singur proces, pool-ul implicit Prisma e „suficient” azi, dar complet netunat/neobservat. La mai multe instanțe, fiecare își deschide propriul pool implicit — risc real de epuizare a `max_connections` din Postgres.

### 1.5 Query-uri `findMany` nepaginate (cresc liniar cu tabelul)
- `FeedService.list()` (`feed.service.ts:234`) — **cel mai critic**, vezi §3.
- `AnalyticsService.feedRankFor()` (`analytics.service.ts:247-253`) — recalculează rank-ul re-interogând toate companiile din grup, apelat din `companyAnalytics()` de fiecare dată când o campanie activă e vizualizată.
- `NotificationsService.notifyAll()` (`notifications.service.ts:107-110`) — toți utilizatorii activi, fără `take`.
- `NotificationsSweepService.sweepLowBalances()` (`:92-95,104-106`) — campanii active + portofele, fără `take`.
- `NotificationsSweepService.sweepDepletedCampaigns()` (`:51-58`) — nepaginat.
- `CompaniesService.sweepStaleDrafts()` (`companies.service.ts:95-104`) — nepaginat.
- `WalletService.refundableMinor()`/`requestRefund()` — nepaginat, dar mărginit de un singur utilizator, risc mic.
- `ProV2Service.searchFiles()` (`pro-v2.service.ts:263-271`) — încarcă **conținutul întreg** al tuturor fișierelor unui proiect, caută cu `.includes()` în JS, fără filtrare SQL.
- Contraexemplu bun în același modul: `AnalyticsService.visibilityInputsFor()`/`cpcRefsFor()` — corect batch-uite cu `Promise.all` + `{ in: companyIds }`, fără buclă per-item.
- Listele admin (users, businesses, invoices, affiliate) **paginează corect** cu `skip`/`take` în `$transaction([...findMany, ...count])`.

### 1.6 Bucle secvențiale per-rând (formă N+1) după un `findMany` nepaginat
Toate în `src/notifications` și `src/companies`:
- `sweepDepletedCampaigns()`: `for (const c of campaigns) { await notify(...); await campaign.update(...); }` — secvențial, ne-batch-uit.
- `sweepLowBalances()`: aceeași formă.
- `notifyAll()`: buclă secvențială `await mail.send(...)` per utilizator (§5).
- `notify()` însuși: pentru canalul email, un al doilea round-trip (`user.findUnique` doar pentru email) + un al treilea (`notification.update` după trimitere) — 3 query-uri secvențiale per notificare-cu-email.
- `sweepStaleDrafts()`: `for (...) { await scheduleDeletion(id); }`, iar `scheduleDeletion` face el însuși ≥2 query-uri suplimentare.
- `SupportService.notifyStaff()`: secvențial per membru staff (mărginit de numărul de angajați, risc mic).
- `WalletService.sweepDueRefunds()`: secvențial per refund scadent, fiecare cu apel real către Stripe API în buclă.

### 1.7 Tranzacții și locking — inventar complet
Niciun `$queryRaw`/`SELECT ... FOR UPDATE` de blocare nicăieri (singurele `$queryRaw` găsite sunt agregări read-only). Niciun câmp `version` pentru concurență optimistă pe niciun model. Toate `$transaction`-urile rulează sub izolarea implicită Postgres (**READ COMMITTED**) — nicăieri nu e setat explicit `isolationLevel`.

| Locație | Protejează |
|---|---|
| `wallet.service.ts:232` (`adjust`) | Credit/debit admin |
| `wallet.service.ts:488` (`confirmPurchase`) | Achiziție pending→completed |
| `wallet.service.ts:676` (`chargeAiUsage`) | Debitare uz AI |
| `wallet.service.ts:707` (`spendWithin`) | Debitare generică |
| `campaign.service.ts:247` (`registerClick`) | Click + contor cheltuială + debitare portofel |
| `wallet.service.ts:762` (`requestRefund`) | Rezervare refund |
| `wallet.service.ts:863`/`1031` | Anulare/eșec refund |
| `campaign.service.ts:105,758` | Stare campanie/companie |
| `affiliate.service.ts:162` (`maybeReward`) | Recompensă afiliere — **singurul loc cu CAS real** (`updateMany` condiționat, nu citire-apoi-scriere) |
| `companies.service.ts:331,592,633,676` | Creare/ștergere companie |
| `billing.service.ts:297` | Emitere factură |
| `password-reset.service.ts:74` | Schimbare parolă |
| `support.service.ts:171` | Mesaj + status tichet |
| `pro-v2.service.ts:448` | Publicare bundle site |
| `admin-users.service.ts:270,312`, `admin-companies.service.ts:319,346,414` | Loturi de efecte admin |

### 1.8 Sănătatea migrațiilor
41 de migrații (`20260829165402_init` → `20260920220843_add_notification_dismissed_at`). Nicio migrație nu adaugă `NOT NULL` fără default. **O singură migrație** conține backfill pe date existente: `20260830220622_wallet_per_user` — adaugă coloane nullable, le populează prin `UPDATE ... FROM`, apoi rulează două treceri cu `ROW_NUMBER() OVER (PARTITION BY ...)` pe **tot tabelul `wallets`** ca să detecteze și să unească portofele duplicate per companie într-unul per utilizator, re-alocă tranzacțiile, șterge portofelele suprimate — fără batching. Ok la volumul de atunci; riscantă dacă ar trebui rulată din nou pe un `wallets`/`wallet_transactions` mare.

---

## 2. Feed & sistemul de „auctions” (ranking + facturare CPC)

### 2.1 Nu există o licitație live
E un **scor de vizibilitate recalculat la fiecare cerere**, nimic precalculat/cache-uit/stocat.

- `FeedService.list()` (`feed.service.ts:188-263`): `prisma.company.findMany({ where, include: feedInclude })` — **fără `ORDER BY`, fără `take`/`skip` în SQL** (linia 234). Apoi, în JS:
  - `AnalyticsService.visibilityInputsFor()` (`analytics.service.ts:101-152`) — 4 query-uri suplimentare (campanii, site-uri, agregare timp de răspuns leaduri, `cpcRefsFor`).
  - `visibilityScore(...)` (`analytics/visibility.ts:150-173`) calculat per companie, în proces.
  - `scored.sort((a,b) => b.score - a.score)` (linia 263) — **sortare în memorie**, apoi `scored.slice(start, start+pageSize)` (linia 267) — paginarea se aplică **după** ce tot setul de rezultate al categoriei a fost încărcat și scorat.
- Formula (`visibility.ts:171`): `score = 0.35×cpc + 0.30×răspuns + 0.20×plan + 0.15×vechime_campanie`, plafonat 0–1, plus `+0.25` fix (`APPEAR_FIRST_BOOST`) dacă `campaign.appearFirst && status==='active'`.
  - `cpcScore` (`:54-64`): CPC-ul propriu relativ la cea mai mare ofertă curentă din categorie, plafonat de bugetul zilnic.
  - `planScore`: plan `advanced` = 1.0, altfel 0.5 — flag static, nu calculat.
- Categoria/orașul/căutarea sunt **doar filtre**, nu reordonează scorul direct (confirmat explicit în cod, `RANKING_NOTE`, `feed.service.ts:13-20`) — căutarea text multiplică scorul cu un factor de relevanță (0.15–1.0), nu e o cheie de sortare separată.
- `AnalyticsService.feedRankFor()` (`:228-287`) — folosit doar pentru afișarea „locul tău” din dashboard — **re-interoghează și re-scorează independent** toate companiile-pereche din grup la fiecare apel, fără cache, fără partajare cu calculul din Feed public.

**Nimic stocat, nimic cache-uit, niciun cron de precalcul.** Fiecare cerere `/feed` și fiecare citire de „rank” din dashboard rulează din nou întreaga scanare + scorare + sortare peste tot setul de companii active al categoriei. E un calcul O(n) per cerere, fără `LIMIT`/`ORDER BY` împins spre Postgres — cel mai clar bottleneck de scalare la 10k+ utilizatori concurenți pe o categorie populară.

### 2.2 Facturarea per-click
Un singur punct de intrare: `POST /feed/click` → `FeedController.click` → `CampaignService.registerClick` (`campaign.service.ts:239-319`). Throttle `40/60s` per apelant (in-memory, per proces).

**Complet sincron, într-un singur `$transaction`:**
1. `tx.adClick.create({ companyId, visitorHash })` — `visitorHash = sha256(ip|userAgent|companyId|zi)`.
2. La violare de constrângere unică (`P2002` pe `@@unique([companyId, visitorHash])`) → prins, returnat `{ billed: false, reason: 'repeat' }` — **asta e protecția anti-dublă-facturare**, derivată, nu un token de idempotență trimis de client.
3. Verificare bot (UA) → gratuit dacă bot.
4. Citește campania proaspăt, în aceeași tranzacție.
5. Verificare buget: `spentToday + cpcMinor > dailyBudgetMinor` → dacă depășit, `setDepletedWithin` + gratuit.
6. `WalletService.chargeClickWithin` — debitare portofel + rollup zilnic (vezi §4.5). Returnează `null` dacă nu se poate acoperi → campanie epuizată, gratuit.
7. `tx.campaign.update({ data: { spentTodayMinor: newSpent, spendDay: today } })` — **`SET` literal, nu `{ increment: cpcMinor }`, fără `WHERE spent+cost<=budget`**.
8. `tx.adClick.update({ billed: true, costMinor })`.
9. Verificare post-facturare pentru epuizare imediată.

Totul (rândul de click, debitarea portofelului, rollup-ul, contorul de cheltuială al campaniei) se comite atomic împreună — dacă tranzacția eșuează, nimic nu se aplică parțial. Protecția anti-duplicat pentru același vizitator/zi e solidă (constrângere DB, nu citire-verificare predispusă la rasă).

### 2.3 Race condition confirmat — contorul de cheltuială zilnică
Fără `SELECT ... FOR UPDATE`, fără `isolationLevel` custom nicăieri (confirmat cu grep). Deci READ COMMITTED implicit.

```ts
const campaign = await tx.campaign.findUnique({ where: { companyId } });   // SELECT simplu, fără lock
const spentToday = dayRolled ? 0 : campaign.spentTodayMinor;
if (spentToday + campaign.cpcMinor > campaign.dailyBudgetMinor) { /* epuizat */ return; }
const newSpent = spentToday + campaign.cpcMinor;
await tx.campaign.update({ data: { spentTodayMinor: newSpent, spendDay: today } }); // SET literal
```

Două tranzacții `registerClick` concurente pentru **aceeași companie** (doi vizitatori diferiți, click aproape simultan) pot citi amândouă același `spentTodayMinor`, trec amândouă verificarea de buget independent, apoi scriu fiecare `SET spentTodayMinor = <propria valoare calculată>`. Postgres serializează cele două `UPDATE`-uri la nivel de rând (a doua așteaptă commit-ul primei), dar pentru că valoarea scrisă e calculată din codul aplicației pe baza unei citiri deja învechite, a doua scriere **suprascrie** prima — contribuția unui click la `spentTodayMinor` se pierde silențios. Efect: contorul intern de „cheltuit azi” subestimează cheltuiala reală, deci campania poate fi facturată (și afișată în Feed) peste `dailyBudgetMinor`-ul configurat sub click-uri concurente, chiar dacă fiecare tranzacție individuală „a verificat” bugetul.

### 2.4 Race condition confirmat — soldul portofelului poate deveni negativ
`WalletService.chargeClickWithin` (`wallet.service.ts:611-628`):
```ts
const wallet = await tx.wallet.upsert({ where: { userId }, ... });          // citire, fără lock
if (wallet.blockedAt || wallet.balanceMinor < amountMinor) return null;      // verificare pe citire posibil învechită
const updated = await tx.wallet.update({ data: { balanceMinor: { decrement: amountMinor } } }); // atomic, dar necondiționat
```
Decrementul în sine e SQL atomic (`balance_minor = balance_minor - $1`), dar **nu există niciun `CHECK constraint`** `balance_minor >= 0` în schemă (`model Wallet`, coloană `Int @default(0)` simplă) și **nicio clauză `WHERE balanceMinor >= amountMinor`** pe `UPDATE`. Exemplu concret: sold = 5 credite, CPC = 5 credite, două click-uri concurente pentru aceeași companie/proprietar (vizitatori diferiți, deci trec de deduplicarea per-vizitator din §2.2). Ambele tranzacții citesc `balanceMinor = 5 >= 5` → ambele trec. Postgres serializează cele două `UPDATE ... decrement`: prima comite, sold = 0; a doua, deblocată după, aplică propriul decrement necondiționat peste: sold = 0 − 5 = **−5**. Comentariul din cod chiar deasupra funcției spune explicit „returnează `null` dacă soldul nu poate acoperi încă un click” — dar codul efectiv permite soldul negativ sub două click-uri simultane pe același proprietar, când soldul e între 1× și 2× costul CPC. **Bani reali, nu doar un contor de afișare.**

Rândul de rollup (`walletTransaction`, §4.5) rămâne intern consistent (increment/decrement atomice), deci ledger-ul va arăta corect ambele debitări de `-cpc` — soldul negativ e real, nu un artefact de contabilizare.

### 2.5 Editare buget vs. click concurent
`CampaignService.saveFor` (editorul de buget/CPC) și `registerClick` rulează ca **două tranzacții complet separate**, fără lock partajat, fără verificare de versiune, fără serializare între ele. `saveFor` citește campania **în afara** oricărei tranzacții, apoi face un singur `upsert` — atomic pentru acea scriere, dar fără să recalculeze `spentTodayMinor` față de noul buget. Dacă proprietarul scade bugetul zilnic exact când un click e în curs, rezultatul depinde pur de ordinea de commit — fără nicio logică care să recalculeze `spentTodayMinor` față de noul buget la momentul editării.

### 2.6 Auto-optimizare — nu există cron pentru campanii
Confirmat prin grep: niciun `setInterval`, `setTimeout`, `@Cron` sau `OnModuleInit` în `src/campaigns`/`src/analytics`, spre deosebire de wallet (refund sweep), notificări (sweep) și companii (sweep-uri de ciornă/reamintire). În schimb, reconcilierea (auto-CPC, revive/depletion) se face **leneș, inline, la citire**, prin `CampaignService.reconcile()` (`campaign.service.ts:169-229`, comentariu explicit la linia 188: „nu există cron, deci asta se întâmplă la fiecare citire”). Apelat doar din `getFor`, `optimizationFor`, `spendReportFor`, `summaryFor` — adică doar când proprietarul sau adminul deschide efectiv pagina campaniei. **Feed-ul public nu apelează `reconcile()` deloc** — citește câmpurile campaniei direct prin `visibilityInputsFor`. Consecință: dacă nimeni nu deschide dashboard-ul, auto-CPC rămâne neactualizat (deși limita de buget la facturare tot se aplică independent, sub rezerva rasei din §2.3).

---

## 3. Portofel / Credite / Facturi / Plăți Stripe

### 3.1 Siguranța mutațiilor de sold — tipar general
Fiecare cale e învelită în `$transaction`, și fiecare scriere pe `Wallet.balanceMinor` folosește `{ increment/decrement }` (compilat ca `SET balance = balance ± X`, nu o rescriere literală) — deci **nu** e tiparul clasic „citește-calculează-rescrie” pentru aritmetica în sine. **Dar nicio cale nu folosește un singur `UPDATE` condiționat** de forma `WHERE balance >= X` (verificat prin numărul de rânduri afectate). Verificarea de suficiență e mereu o citire separată, anterioară; scrierea e mereu un increment/decrement atomic dar necondiționat. Invarianta „soldul nu poate fi negativ” **nu e impusă atomic nicăieri** — doar aritmetica brută e fără-rasă.

- **Confirmare achiziție** (`confirmPurchase`, `wallet.service.ts:488-518`): tranziția `pending→completed` e o citire-apoi-scriere simplă, **nu** un `updateMany({ where: { id, status: 'pending' } })` de tip compare-and-swap. Două apeluri concurente de confirmare pentru **același** `transactionId` (dublu-click, retry client) pot ambele citi `status==='pending'` înainte ca vreuna să comită, ambele incrementează soldul. Singurul lucru care previne dublarea reală e o **constrângere accidentală**: `Invoice.walletTransactionId` e `@unique`, deci a doua tranzacție eșuează la crearea facturii și face rollback (inclusiv la incrementul de sold). Salvat de o constrângere de schemă întâmplătoare, nu de logică de idempotență proiectată.
- **Debitare click CPC** (`chargeClickWithin`) — vezi §2.4.
- **Cerere refund** (`requestRefund`, `wallet.service.ts:762-836`): aceeași formă — citire simplă, apoi decrement necondiționat.
- **Ajustare manuală admin** (`adjust`, `wallet.service.ts:224-247`) — **mai slabă**: plafonul „nu sub zero” e calculat **în afara** tranzacției, pe baza unei citiri separate anterioare:
  ```ts
  const wallet = await this.ensureWallet(userId);              // citire ÎN AFARA tranzacției
  let deltaMinor = ...;
  if (wallet.balanceMinor + deltaMinor < 0) deltaMinor = -wallet.balanceMinor;   // plafonat pe citire învechită
  await this.prisma.$transaction(async (tx) => { ... increment: deltaMinor ... });
  ```
  Scrierea în sine e atomică, dar `deltaMinor` e plafonat pe o valoare deja învechită la momentul scrierii.
- **Debitare uz AI** (`chargeAiUsage`, `wallet.service.ts:671-694`) — tipar identic, citire în afara tranzacției.
- **Recompensă afiliere** (`affiliate.service.ts:142-247`) — **singurul loc cu protecție reală**: `tx.referral.updateMany({ where: { id, status: 'pending' }, data: { status: 'rewarded', ... } })`, verificat prin `locked.count === 0`. E o creditare pură (fără risc de sold negativ), dar tiparul CAS e corect — modelul de urmat pentru restul.

### 3.2 Nu există webhook Stripe — deloc
Confirmat explicit: `src/stripe/` conține doar `stripe.module.ts` și `stripe.service.ts` — **niciun controller**. Grep pe tot repo-ul pentru `webhook`, `constructEvent`, `stripe-signature`, `STRIPE_WEBHOOK` → zero rezultate. `stripe.service.ts` expune doar `createCheckoutSession`, `retrieveCheckoutSession`, `createRefund`.

Confirmarea plății e **complet condusă de client**: `POST /wallet/purchases/:id/confirm` e apelat doar când browserul e redirecționat înapoi pe `successUrl` după Stripe Checkout. `confirmPurchase` re-verifică independent cu API-ul Stripe (`session.payment_status !== 'paid'`) înainte de a credita, deci un apel fals/orb nu poate fabrica o plată. **Dar dacă utilizatorul plătește cu succes și nu se mai întoarce pe pagina de succes** (tab închis, rețea căzută, crash), tranzacția rămâne `pending` **pentru totdeauna** — Stripe a încasat banii, dar portofelul nu e creditat niciodată, și **nu există niciun job de reconciliere** care să scaneze tranzacțiile Stripe rămase în pending (există sweep pentru refund-uri, nu și un echivalent pentru achiziții neconfirmate).

Fără webhook, întrebarea „dacă Stripe retrimite evenimentul, se dublează creditarea?” nu se aplică direct — dar riscul echivalent (procesarea dublă a **aceluiași** apel client de confirmare) se aplică, și e acoperit doar de constrângerea accidentală de la §3.1. Nu există `stripeEventId` sau vreo constrângere unică pe `providerRef` (care ține ID-ul sesiunii Checkout, apoi al PaymentIntent-ului).

### 3.3 Numerotarea facturilor
`BillingService.nextInvoiceNumber` (`billing.service.ts:95-114`), pe modelul `InvoiceCounter` (`series` = `@id`, `year`, `nextSeq`).

- **Regim normal** (anul curent, rândul de contor există deja): `nextSeq: { increment: 1 }`, `seq` derivat din rezultatul propriu al update-ului — **fără-rasă**, corect.
- **Ramura de trecere de an / prima factură vreodată**: când `!existing || existing.year !== year`, `seq` e **hard-codat la `1`**, indiferent de ce a făcut efectiv `upsert`-ul. Două facturi emise concurent exact la acest prag (prima factură vreodată, sau prima a unui an nou) pot citi amândouă starea „nu încă acest an” înainte ca vreuna să comită, ambele calculează `seq = 1`, produc **același număr de factură**. Prinsă doar de constrângerea `@unique` pe `Invoice.number` — a doua tranzacție `tx.invoice.create` aruncă și face rollback (inclusiv la incrementul de sold din aceeași tranzacție). Eșuează sigur (fără numere duplicate persistate, fără creditare dublă silențioasă), dar una din cele două achiziții legitime pică și trebuie reîncercată. Fereastră îngustă (o dată pe an, sau o dată la deployment nou), dar e un tipar real „citește-apoi-hardcodează”, nu incrementul atomic din ramura normală. `issueAffiliateRewardInvoice` folosește aceeași funcție și are aceeași expunere.

### 3.4 Fluxul de refund
**Cerere** (`requestRefund`): rezervă imediat — decrementează soldul, creează un rând `refund` cu `status: 'pending'` și `processAt = acum + 7 zile` — într-o singură tranzacție. Vezi §3.1 pentru rasa de pe verificarea de suficiență.

**Sweep** (`onModuleInit`, `wallet.service.ts:55-62`): `setTimeout(90s)` prima rulare, apoi `setInterval` **orar**.

`sweepDueRefunds` (`:924-941`): `findMany` simplu, neblocat (**nu** `SELECT ... FOR UPDATE SKIP LOCKED`), fără să marcheze un status de „preluat” înainte de procesare. `for (const {id} of due) { await executeRefund(id).catch(...) }`.

`executeRefund` (`:958-1020`): `if (!refund || refund.status !== 'pending') return;` — verificare simplă pe citire, **nu** un CAS (`updateMany` condiționat + verificare de count). Dacă e configurat Stripe, sună `stripe.refunds.create` per sursă, **în buclă**, și abia **după** ce toate apelurile Stripe reușesc scrie `status: 'completed'`.

**Consecințe:**
- Dacă `sweepDueRefunds` ar rula vreodată mai mult de o oră (mulți refund-uri scadente sau Stripe lent), tick-ul următor ar porni concurent — ambele treceri ar găsi aceleași ID-uri scadente și ar apela `executeRefund` pe același id concurent, ambele trecând verificarea `status !== 'pending'` înainte ca vreuna să scrie `completed` → **două apeluri separate `stripe.refunds.create` pentru aceeași achiziție-sursă — bani reali trimiși de două ori către cardul clientului.**
- **Mai grav pentru un deployment scalat**: e un `setInterval` simplu în proces, fără lock distribuit. Dacă backend-ul rulează pe mai mult de o instanță (aproape obligatoriu pentru 10k+ utilizatori concurenți), **fiecare instanță rulează propriul sweep orar, independent**, fără nicio coordonare. Fiecare instanță găsește aceleași rânduri scadente și concurează să le proceseze — riscul de mai sus devine rutină, nu doar teoretic.
- `markRefundFailed` are același tipar de verificare simplă, fără CAS.
- `cancelRefund` verifică `status !== 'pending'` și `processAt <= now`, tot printr-o citire simplă, în propria tranzacție — o anulare care se suprapune cu un `executeRefund` în curs (chiar în momentul apelului Stripe) nu e demonstrabil serializată față de acesta.

### 3.5 Rollup-ul de facturare (click-uri CPC)
Confirmat corect și atomic — vezi §2.2/§2.4. Constrângerea `@@unique([walletId, companyId, provider, spendDay])` + `upsert` cu `{ increment/decrement }` e un `INSERT ... ON CONFLICT DO UPDATE` real la nivel Postgres. Două click-uri concurente pentru aceeași pereche `(companie, zi)` se serializează corect pe acest index unic — rândul de rollup nu pierde/dublează `amountMinor`/`clickCount`. **Notă**: siguranța acestui upsert e independentă de, și nu rezolvă, rasa de la §2.4 — decrementul de sold care are loc chiar înainte de acest upsert e tot o citire simplă urmată de un decrement necondiționat.

### 3.6 Reprezentarea banilor
Confirmat integer peste tot: `Wallet.balanceMinor`, `WalletTransaction.amountMinor/balanceAfterMinor/eurCents/ronBani/refundReservedMinor/feeMinor`, `Invoice.subtotalMinor/vatMinor/totalMinor/eurCents`, `Campaign.dailyBudgetMinor/cpcMinor/spentTodayMinor`, `AdClick.costMinor` — toate `Int`. `money.ts` documentează explicit motivul. Singurele coloane `Float` monetar-adiacente sunt neaferente ledger-ului de credite (`estimatedCostUsd` intern pentru cost AI, coordonate geo). `fxRate` e `Decimal(10,4)`, folosit doar ca multiplicator, rezultatul mereu `Math.round`-uit înapoi la un întreg înainte de persistare. **Zero risc de eroare de rotunjire în bani persistați.**

### 3.7 Interacțiune achiziție + refund concurente
Două tranzacții separate, fără lock partajat, fără `SELECT ... FOR UPDATE`, fără izolare serializabilă. Ambele folosesc `{ increment/decrement }` atomic, deci **aritmetica** nu se pierde la interfoliere — Postgres serializează cele două `UPDATE`-uri la nivel de rând. **Dar deciziile** (verificarea de suficiență din `requestRefund`) se iau pe baza unei citiri posibil învechite — dacă incrementul unei confirmări de achiziție e încă „în zbor” (necomis) exact când tranzacția de refund citește soldul, decizia „e destul sold pentru refund” se poate lua pe o instantanee care e pe cale să se schimbe. Nimic nu forțează aceste două tranzacții să se serializeze la citire; doar scrierile lor finale se serializează prin lock-ul de rând.

---

## 4. Notificări / WebSocket / Email

### 4.1 Fluxul complet de creare → livrare
Logica centrală: `NotificationsService.notify()` (`notifications.service.ts:54-100`). Toate feature-urile o folosesc în loc să atingă direct `MailService`/gateway-ul.

Exemplu concret — „lead nou” (`src/leads/leads.service.ts`):
1. `prisma.lead.create(...)` (awaited, în handler-ul cererii). Poate arunca `P2002` pe `@@unique([companyId, visitorHash])` — prins, tratat ca succes silențios (deduplicare la nivel de lead).
2. `void this.notifyOwner(...).catch((err) => logger.error(...))` — **fire-and-forget**: cererea HTTP care procesează formularul de lead **nu așteaptă** acest apel și returnează `{ ok: true }` indiferent.
3. Înăuntrul `notify()`:
   - `prisma.notification.create(...)` — **awaited** (insert DB, blocant în interiorul task-ului de fundal, nu al cererii originale).
   - Dacă `channels.panel`: `gateway.pushToUser(...)` — **nu e awaited** (metodă sincronă `void`: `server?.to(userId).emit('notification', payload)`).
   - Dacă `channels.email` (leadurile au mereu `{ panel: true, email: true }`): `prisma.user.findUnique` (round-trip suplimentar doar pentru email) apoi `await this.mail.send(...)` — **awaited sincron inline**, blochează finalizarea lui `notify()` până termină SMTP-ul sau eșuează. Dacă trimite, un al doilea `notification.update` (setează `emailSentAt`), awaited.

Deci: insert-ul DB e sincron în `notify()`; push-ul pe socket e fire-and-forget; email-ul E awaited inline în `notify()`, dar pentru că **întregul** lanț `notifyOwner`/`notify()` e invocat prin `void ... .catch()` din calea cererii, trimiterea email-ului nu blochează **niciodată** răspunsul HTTP către vizitator. Blochează însă lanțul de microtask-uri al task-ului de fundal.

### 4.2 Scenarii de fan-out — tabel complet
| Loc | Declanșator | Fan-out aproximativ | Tipar de scriere DB |
|---|---|---|---|
| `leads.service.ts:130` | Lead nou | 1 proprietar | `create` simplu |
| `auth.controller.ts:96` | Login de pe dispozitiv nou | 1 utilizator | `create` simplu |
| `account.service.ts:95,132,181,210` | Email/parolă/TOTP schimbate | 1 utilizator | `create` simplu |
| `admin-companies.service.ts:440,466` | Admin suspendă/reactivează afacere | 1 proprietar | `create` simplu |
| `admin-users.service.ts:284,342` | Admin suspendă/reactivează utilizator | 1 utilizator | `create` simplu |
| `billing.service.ts:376,402` | Factură anulată/restaurată | 1 utilizator | `create` simplu |
| `campaign.service.ts:828,909` | Campanie pauzată/activată | 1 proprietar | `create` simplu |
| `companies.service.ts:53,135,703,740` | Afacere creată/reamintire/ștergere programată/anulată | 1 proprietar | `create` simplu |
| `support.service.ts:293,321` | Tichet asignat / actualizare | 1 utilizator | `create` simplu |
| `support.service.ts:342-371` (`notifyStaff`) | Tichet nou neasignat | toți membrii staff cu rol support/admin | **buclă `for` secvențială**, un `create` per membru |
| `pro-v2-agent.service.ts:525` | Job AI eșuat | 1 utilizator | `create` simplu |
| `notifications-sweep.service.ts:66,121` | Campanie epuizată / sold scăzut (orar) | 1 proprietar per rând, buclă secvențială | secvențial, ne-batch-uit |
| **`admin.controller.ts:173` (`notifyAll`)** | **Anunț admin de întreținere** | **toți utilizatorii activi de pe platformă** | rândurile DB **batch-uite** (`createMany`) — **email-ul NU e batch-uit** |
| **`platform-settings.service.ts:375,389` (`notifyAll`)** | **Activare/încheiere discount platformă** | **toți utilizatorii activi** | idem — DB batch-uit, email secvențial |

**Riscul de fan-out semnalat**: cele două căi `notifyAll` sunt singurele care pot notifica sute/mii de utilizatori dintr-o singură cerere. Scrierea DB e corect batch-uită prin `createMany`, dar calea de email e o **buclă secvențială, awaited, o conexiune SMTP per mesaj** (comentariu explicit în cod, `notifications.service.ts:136-138`: *„Secvențial, deliberat — un val de conexiuni SMTP concurente către Gmail e exact genul de lucru care face un cont dev să fie limitat.”*). Pentru 10.000 utilizatori activi, această buclă ar face 10.000 de conexiuni SMTP secvențiale către Gmail (fără `pool: true` pe transportor — §4.4), **direct în interiorul apelului awaited al controller-ului/serviciului** (`admin.controller.ts:173` awaits `notifyAll` fără timeout, fără backgrounding) — cererea HTTP a adminului rămâne deschisă pe toată durata buclei.

### 4.3 Protecție duplicat / idempotență
- Modelul `Notification` (`schema.prisma:1088-1112`) **nu are nicio constrângere unică** legată de evenimentul declanșator (niciun `@@unique` pe ex. `[userId, type, data]`, nicio coloană de idempotency key). Singurii indecși sunt `@@index([userId, createdAt])` și `@@index([userId, readAt])`. `notify()` nu primește niciun parametru de idempotență — nimic nu oprește ca același eveniment logic să producă două rânduri + două email-uri dacă locul de apel e invocat de două ori.
- Singurele mecanisme de deduplicare sunt **câmpuri de cooldown specifice fiecărui domeniu**, verificate **înainte** de a apela `notify()`, și actualizate **după** ce `notify()` returnează — **niciodată în aceeași tranzacție**:
  - `Lead.visitorHash` + `@@unique(...)` — impusă la nivel DB, înainte ca `notify()` să fie vreodată atinsă.
  - `Campaign.depletedNotifiedForDay` — verificat în `WHERE`, apoi `await notify(...)` **urmat de** un `campaign.update` **separat**, necuprins într-o tranzacție. Dacă procesul se prăbușește/eșuează între cele două, sau dacă un pas ulterior din același tick al sweep-ului aruncă înainte de actualizarea flag-ului, următorul sweep orar va notifica din nou aceeași campanie (rând + email duplicat) — prins per-campanie într-un `try/catch` care nu oprește restul sweep-ului, dar lasă flag-ul acelei campanii nesetat.
  - `Wallet.lowBalanceNotifiedAt` — același tipar, aceeași breșă.
  - `Company.deletionReminderSentAt` — același tipar.
- **Direcția erorilor (starea actuală):** rândul DB nu e niciodată anulat de un eșec din aval. `notify()` face `notification.create` primul, apoi push/email fără nicio tranzacție înglobantă și fără try/catch intern în jurul push/email. `mail.send` nu aruncă niciodată (prinde intern, returnează `{ dispatched: false }`), deci singurul lucru care poate arunca după insert e `user.findUnique` sau `notification.update`-ul ulterior — dacă oricare aruncă, `notify()` respinge, dar rândul de notificare persistă oricum.
- **Eșecurile nu maschează niciodată un succes anterior** — fiecare loc de apel inspectat înfășoară `notify()` fie în `void ... .catch(logger.error)`, fie într-un `try/catch` extern, cu comentarii explicite gen *„Deja comis — o problemă de notificare nu trebuie niciodată să mascheze asta.”* — acesta e fix-ul sistemic găsit deja aplicat consecvent.
- **O excepție găsită**: `admin.controller.ts:173` — `await this.notifications.notifyAll(...)` awaited direct în controller, **fără `.catch`**. Dacă `notifyAll` aruncă, cererea `POST /admin/maintenance/broadcast` eșuează cu 500 — dar nimic altceva nu fusese comis înainte în acel handler, deci nu e un caz de „mascare a unui succes anterior”, doar o respingere netratată pe un endpoint altfel all-or-nothing.

### 4.4 Trimiterea email-urilor (`src/mail/mail.service.ts`)
- Provider: **nodemailer**, configurat implicit pentru **Gmail SMTP** (`smtp.gmail.com:587`, STARTTLS), autentificare cu un singur user/parolă de aplicație Gmail.
- **Fără connection pooling**: `createTransport({...})` fără `pool: true` — o conexiune SMTP nouă (inclusiv handshake TLS) la fiecare `sendMail`.
- **Fără nicio coadă/batching** nicăieri — fiecare cale e `await transporter.sendMail(...)`, sincron per apel.
- **Fără timeout explicit** (`connectionTimeout`/`socketTimeout`/`greetingTimeout` nesetate) — se aplică valorile implicite nodemailer (zeci de secunde per etapă). O conexiune Gmail lentă/limitată blochează orice task async care a apelat `mail.send()` pe toată durata aceea.
- **Fără retry**: orice eroare la `sendMail` e prinsă, logată, returnează `{ dispatched: false }` — fără backoff, fără re-coadă. Un send eșuat/limitat e pur și simplu pierdut (rândul din panou rămâne, dar `emailSentAt` rămâne `null`).
- **Fără niciun rate limiter sau plafon de trimitere per provider** — singura „limitare” din tot sistemul e bucla deliberat secvențială (nu concurentă) din `notifyAll` (§4.2), care nu e o limitare reală de rată, doar o serializare accidentală prin await.
- Fallback dev: dacă `SMTP_USER`/`SMTP_PASS` lipsesc, `transporter` e `null` și fiecare trimitere e doar logată — „doar-log-dev”, iar în producție fără transport configurat loghează un avertisment și raportează `dispatched: false` în loc să arunce.

### 4.5 Sweep-ul de notificări (`notifications-sweep.service.ts`)
- Interval **orar** (`SWEEP_INTERVAL_MS = 3.600.000`), pornit prin `setInterval` brut în `onModuleInit()`, cu `setTimeout(120s)` pentru prima rulare. Sărit complet în `NODE_ENV==='test'`.
- Două sub-sweep-uri secvențiale: `sweepDepletedCampaigns()` (campanii epuizate) și `sweepLowBalances()` (calculează necesarul zilnic de buget per proprietar peste toate campaniile active, compară cu soldul, cooldown de 24h prin `lowBalanceNotifiedAt`).
- **Fără niciun lock distribuit, fără nicio gardă de suprapunere.** `sweep()` e invocat pur prin `setInterval`, fără verificare dacă invocarea anterioară încă rulează (fără flag `isRunning`, fără mutex, fără advisory lock). Dacă vreodată sub-sweep-urile ar dura mai mult de 60 de minute față de un tabel `Campaign`/`Wallet` mare, tick-ul următor ar porni concurent, dublând potențial procesarea acelorași rânduri (atenuat doar de verificările de flag din `WHERE`, nu de un lock la nivel de rulare — și cum acele flag-uri sunt setate separat, ne-tranzacțional, rulările suprapuse sau eșecurile parțiale pot produce în continuare notificări duplicate).
- Erorile sunt prinse per sub-sweep și per-rând — o intrare/apel `notify()` defect nu oprește restul tick-ului, dar asta e local per-instanță; **cu mai multe instanțe de aplicație, nu există nicio coordonare** care să prevină ca fiecare instanță să-și ruleze propriul sweep orar independent (ar multiplica notificările cu numărul de instanțe, mărginit doar de aceleași flag-uri de cooldown ne-tranzacționale).

### 4.6 Scenariul de „connection storm” WebSocket (restart server, 10k reconectări)
- `NotificationsGateway` — server Socket.IO implicit, **fără nicio limitare de rată la conectare**. `main.ts` nu instalează niciun `IoAdapter` custom — se aplică valorile implicite ale engine-ului Socket.IO, fără plafon pe rata de acceptare.
- `handleConnection` rulează `SessionService.resolve(token)` la **fiecare** conectare — `prisma.session.findUnique({ where: { tokenHash }, include: { user: { include: { platformRoles: true } } } })`, un round-trip DB cu join pe două niveluri, la fiecare conectare/reconectare, **fără cache**.
- `ThrottlerGuard`-ul global e înregistrat, dar `NotificationsGateway` **nu are niciun `@UseGuards`** — `ThrottlerGuard` al Nest interceptează implicit doar contextul HTTP, nu `handleConnection` pe un gateway WS. **Zero limitare de rată pe încercările de conectare la socket.**
- Client (frontend): `io(socketOrigin(), { path: '/socket.io', withCredentials: true })` — **fără** opțiuni `reconnection`/`reconnectionDelay` custom, deci se aplică valorile implicite socket.io-client: `reconnection: true`, `reconnectionDelay: 1000`, `reconnectionDelayMax: 5000`, `randomizationFactor: 0.5` — **există** backoff exponențial cu jitter implicit (partea de client e ok, nu dezactivată).
- La fiecare `connect` reușit (inclusiv fiecare reconectare), clientul mai face automat **un apel REST separat**: `fetchUnreadCount()` → `GET /notifications/unread-count` → `prisma.notification.count(...)`.
- **Net la 10.000 utilizatori concurenți**: un restart de server declanșează ~10.000 de încercări de reconectare grupate într-o fereastră de ~1-5s (cu jitter), fiecare producând cel puțin un query necache-uit `Session.findUnique` (cu join) **plus** un query separat `Notification.count` prin apelul REST — ambele necache-uite, nelimitate ca rată la nivel de server, pe un backend cu un singur proces, fără cache de sesiuni Redis, fără limitare de rată la conectare.

### 4.7 Creșterea tabelului de notificări / indexare pentru listare
- **Nu există niciun job de retenție/curățare** pentru notificări — confirmat prin grep (`notification.delete`/`deleteMany`/„retention”/„purge” — zero rezultate relevante pe modelul `Notification`). `dismiss()` păstrează rândul pentru totdeauna (comentariu explicit: e trail de audit). **Tabelul crește nemărginit, pentru totdeauna, per utilizator**, pentru fiecare tip de eveniment din §4.2 (inclusiv rândurile zilnice generate de sweep pentru campanii/portofele active).
- Query-ul de listare (dropdown-ul clopoțel): `where: { userId, channels: { has: panel }, dismissedAt: null }, orderBy: { createdAt: 'desc' }`. Indexul `[userId, createdAt]` acoperă egalitatea pe `userId` + ordonarea, dar **nu** `dismissedAt`/`channels` (containment pe array) — Postgres poate „sări” la rândurile utilizatorului ordonate descrescător, dar tot trebuie să filtreze fiecare rând scanat pentru `dismissedAt IS NULL` și `channels @> ARRAY['panel']`. Pe măsură ce rândurile unui utilizator cresc nemărginit, un utilizator cu multe rânduri vechi respinse/doar-email amestecate printre cele panel/necitite ar necesita scanarea dincolo de ele.
- `unreadCount()` — aceeași acoperire parțială de index, și fiind un `count()` nelimitat, trebuie să scaneze integral rândurile care se potrivesc **de fiecare dată când e apelat** — inclusiv la fiecare reconectare de socket (§4.6).

---

## 5. Cron / Background Jobs — inventar complet

Toate cele **4** procese de fundal din aplicație sunt `setInterval()` brut, fără `@nestjs/schedule`, fără lock distribuit, fără gardă de reintrare:

| Sweep | Fișier | Interval | Prima rulare | Risc de suprapunere azi (o instanță) | Risc la scalare orizontală |
|---|---|---|---|---|---|
| Ciorne de afacere abandonate | `companies.service.ts:79-82` | 24h | — | Redus (interval mare) | Multiplicat ×N instanțe |
| Reamintiri de ștergere afacere | `companies.service.ts` | 24h | — | Redus | Multiplicat ×N instanțe |
| Notificări (campanii epuizate + sold scăzut) | `notifications-sweep.service.ts:34-38` | **1h** | 120s după boot | **Real** dacă bucla secvențială depășește ora | **Garantat** — fiecare instanță rulează propriul sweep, flag-urile de cooldown ne-tranzacționale nu protejează cross-instanță |
| Refund-uri portofel scadente | `wallet.service.ts:55-62` | **1h** | 90s după boot | **Real, cu impact financiar** (dublu refund Stripe) | **Cel mai grav** — bani reali trimiși de mai multe ori |

Niciunul dintre cele 4 nu are flag `isRunning`/mutex/advisory lock. La o singură instanță (situația actuală), riscul e mic dar nu zero pentru cele două sweep-uri orare. **La mai multe instanțe — aproape obligatoriu pentru a servi 10k+ utilizatori concurenți pe un proces Node single-thread — fiecare sweep rulează de N ori, complet necoordonat.** Asta transformă riscul din „teoretic, rar” în „garantat să apară, la fiecare tick orar”.

---

## 6. Categorii & filtrare Feed la scară (sute de categorii/subcategorii)

### 6.1 Structura reală
Schema permite un arbore recursiv nelimitat (`Category.parentId` auto-referențial), **dar codul de business impune strict doar 2 niveluri** — orice încercare de a adăuga un al treilea nivel e respinsă. „Sute de categorii” înseamnă deci practic „sute de rânduri pe aceleași 2 niveluri fixe”, nu recursivitate adâncă — semnificativ mai simplu de gestionat decât un arbore general.

### 6.2 Ce funcționează deja la volum mare
- Interogarea arborelui (`AdminCategoriesService.tree()`) e un singur query, fără N+1 — rămâne rapidă la sute de rânduri.
- Filtrarea Feed-ului după categorie-părinte funcționează prin expansiune la un singur nivel de copii — corect **pentru limita actuală de 2 niveluri**, dar codată specific pentru ea (dacă limita ar fi ridicată vreodată, s-ar rupe silențios pentru categoriile mai adânci).
- `Company.categoryId` e indexat (dar fără indexul compus cu `status`, §1.1).

### 6.3 Ce nu funcționează la volum mare
- **Nicio cache-uire** a arborelui de categorii — retrimis la fiecare încărcare de pagină relevantă (excepție: facets-urile Feed, cache-uite per sesiune în frontend).
- **Pagina de administrare a categoriilor** e complet plată, fără paginare, fără căutare — la sute de grupuri, fiecare cu mai mulți copii, devine un singur scroll foarte lung (problemă de UX admin, nu de performanță backend).
- **Cel mai real blocaj găsit**: selectorul de recategorisire a unei afaceri din `AdminCompanyDetailView.vue` pune **toate** categoriile-frunză din toată platforma într-un singur `<v-select>` **fără căutare/autocomplete**. La sute de subcategorii, devine efectiv nefolosibil pentru un admin.
- `Category.parentId` neindexat — risc mic dat fiind volumul mic la 2 niveluri, dar merită de reținut dacă „sute” ar deveni „mii”.

---

## 7. Website Builder / procese AI / WebContainer

### 7.1 Execuție complet sincronă, fără coadă
Confirmat: **niciun** job de fundal, nicio coadă, niciun pattern de polling nicăieri în `src/` (fără BullMQ/Bottleneck/Redis/librărie de queue).

- `AiService.anthropicJson`/`anthropicText` — apeluri `await`-ate direct în lanțul handler-ului HTTP, timeout `20s` sau `60s` (planuri).
- **Builder-ul agentic PRO V2** (`pro-v2-agent.service.ts`) e cel mai greu: bucla multi-turn de folosire a uneltelor rulează **sincron**, fiecare iterație awaited cu timeout `60s`, până la **24 iterații**, putând escalada pe **3 nivele**. În cel mai rău caz, zeci de apeluri AI secvențiale plafonate la ~60s fiecare **într-un singur ciclu request/response HTTP**, fără niciun timeout de nivel-cerere impus în `main.ts` — doar timeout-ul per apel și un plafon de cost (`0.75 USD`/cerere) îl mărginesc. O cerere `/pro-v2/message` poate ține realist o conexiune Node deschisă multe minute într-un caz de escaladare nefavorabil.
- **Fără nicio limitare de concurență** globală sau per-utilizator pe apelurile AI — singurele „porți” sunt verificarea de sold din portofel (nu o limitare de concurență) și throttling-ul per-IP (8/min pe `/pro-v2/message`, cel mai strict găsit) — mai multe cereri pot fi totuși în zbor simultan în fereastra de o oră/minut.

### 7.2 WebContainer — fără compute greu pe server
Confirmat explicit prin comentarii în cod: `npm install`/`vite dev`/preview-ul live există **doar în browser**, prin WebContainer — serviciul backend nu poate executa/type-check proiectul. Rolul backend-ului se limitează la: persistarea arborelui de fișiere virtual ca rânduri DB, primirea unui `publish` cu output-ul deja construit de browser (stocat ca `Bytes`), primirea de rapoarte text de eroare. **Niciun `child_process`/`spawn`/`exec`** legat de WebContainer.

### 7.3 Upload-uri de imagini
Stocate ca `Bytes` **în Postgres**, nu pe disc, nu cloud storage (confirmat, §0).
- `MAX_ASSET_BYTES = 4.500.000` (cap pe dimensiunea decodată), regex de validare pe forma data-URI, plafon de **60 de asset-uri per companie**.
- **Presiune de memorie la concurență**: limita de body JSON e 12MB/cerere; base64 umflă cu ~33%, deci un body de 12MB poate teoretic transporta ~9MB de imagine brută decodată (peste plafonul de 4.5MB, deci cele supradimensionate sunt respinse **după** buffering/decodare completă). Fiecare astfel de cerere: buffering complet Express (~12MB) + un buffer decodat separat (~9MB) + acel buffer ținut în memorie pe durata round-trip-ului către Postgres. La concurență mare, asta înseamnă `cereri_concurente × ~21MB` presiune tranzitorie pe heap, **într-un singur proces Node** (fără cluster mode) — fără nicio limitare de memorie agregată dincolo de plafonul flat de 12MB/cerere și rata de cereri/minut, niciuna dintre ele nemărginind memoria totală concurentă în zbor.

---

## 8. Rate limiting — inventar complet

Guard global: `120/min` per IP (`app.module.ts:31,54`), store implicit **în memorie** (fără Redis, fără `ThrottlerStorage` custom) — cheia implicită e IP-ul.

Override-uri per rută găsite (toate `@Throttle`):
- Auth: login/register/reset — `5-10/min`.
- Feed click: `40/min`.
- Lead public: `15/min`.
- Easy-site builder: `12-120/min` în funcție de operație.
- Website draft (Simple builder): `6/oră` pentru creare, `10-120/min` pentru restul operațiilor.
- **PRO V2**: `message`/`repair` = `8/min`, `publish` = `6/min`, `assets` = `20/min` — cel mai strict limitator legat de AI din tot sistemul.

Toate limitările sunt **per-IP**, nu per-utilizator, și nu limitează apelurile AI concurente — doar frecvența lor pe fereastra de timp. **Fiind în memorie, per proces**, limitele nu mai sunt globale în clipa în care există mai mult de o instanță — fiecare instanță ar permite independent propriul plafon per IP.

---

## 9. Deployment / Infrastructură

- **Fără Dockerfile** nicăieri în repo. `docker-compose.yml` = doar Postgres de dev.
- **Un singur proces PM2** (`tvz-api`), pornit `pm2 start dist/main.js` **fără** flag de cluster, **fără** `ecosystem.config.js` în repo.
- Deploy: GitHub Actions → SSH pe **un** VPS → `git pull` → `npm ci` → `prisma migrate deploy` → `build` → `pm2 restart`/`start`. `concurrency: { group: deploy-vps, cancel-in-progress: false }` confirmă o singură țintă de deploy, secvențial.
- **Fără load balancer nicăieri.**
- **Fără coordonare multi-instanță pentru Socket.IO** — niciun `@socket.io/redis-adapter`, nicio dependență Redis/ioredis în `package.json`. Inofensiv azi doar pentru că există exact un proces/instanță.
- CORS: `origin` REST = un singur string dintr-o singură variabilă de mediu (`FRONTEND_ORIGIN`) — presupunere explicită de single-origin. **Inconsistent** cu CORS-ul Socket.IO, care folosește `origin: true` (reflectă/acceptă orice origine cu credențiale) — o politică vizibil mai permisivă chiar alături de cea REST.

---

## 10. Validare mediu / configurare

- Doar `DATABASE_URL` oprește pornirea în producție dacă lipsește. Orice altceva (Stripe, chei AI, SMTP, `FRONTEND_ORIGIN`) cade silențios pe un fallback gol/implicit, **inclusiv în producție** — un deploy de producție care uită `FRONTEND_ORIGIN` ar servi silențios CORS pentru `localhost:5173` în loc să eșueze vizibil.
- `scripts/ensure-env.js` e o comoditate de dezvoltare (copiază `.env.example` → `.env` dacă lipsește, din cauza sincronizării OneDrive) — nu validează valori, doar existența fișierului.

---

## 11. Implicații de cost operațional

- **Storage-ul de imagini/bundle-uri de site în Postgres** (nu S3) înseamnă că baza de date crește cu fiecare imagine încărcată și cu fiecare site publicat. Neobișnuit față de practica standard (blob-uri binare de obicei în object storage, nu în DB relațională) — cost operațional real la scară: tier Postgres gestionat mai scump pentru o bază mai mare, backup-uri mai mari/mai lente, I/O partajat cu query-urile tranzacționale pe aceeași instanță.
- **Un singur VPS** permite scalare verticală relativ ușor (mașină mai mare) până la un punct, dar scalarea orizontală — practic obligatorie pentru 10k+ utilizatori concurenți pe un proces Node single-thread care servește simultan REST + WebSocket + apeluri AI sincrone — necesită tot ce e listat în §12 de mai jos.
- **Costul apelurilor AI sincrone**: fără coadă, fiecare cerere de builder AI ține ocupată o conexiune + resursele asociate pe toată durata (până la minute în cazuri de escaladare) — la volum concurent mare, asta se traduce direct în nevoie de mai multe resurse de server doar pentru a ține conexiunile deschise, indiferent de costul-per-token al AI-ului în sine.

---

## 12. Sinteza — răspuns direct la cele 12 întrebări

### 12.1 Ce e deja pregătit pentru 10.000+ utilizatori
Modelul de bani (întregi, fără float); rollup-ul zilnic de click-uri CPC (upsert atomic pe constrângere unică); deduplicarea click-urilor per vizitator/zi; sesiunile (indexate corect); reconnect-ul WebSocket din client (backoff/jitter implicit, nu dezactivat); paginarea corectă în listele admin; migrațiile (fără `NOT NULL` neprotejat).

### 12.2 Ce nu e pregătit
Toate cele 4 sweep-uri de fundal (fără coordonare multi-instanță); WebSocket-ul (fără adapter Redis — nu funcționează corect cu mai multe instanțe); rate limiter-ul (store în memorie, per proces); trimiterea de email (Gmail, fără pool, fără retry, broadcast secvențial); absența completă a unui webhook Stripe; conexiunile DB (fără pooler extern); storage-ul de imagini (în Postgres, nu obiect extern); validarea de mediu (doar `DATABASE_URL` obligatoriu).

### 12.3 Principalele bottleneck-uri
Query-ul de Feed (fără `LIMIT` SQL, sortare completă în JS la fiecare cerere); email-urile secvențiale la broadcast; lipsa indexului compus `Company(status, categoryId)`; căutarea text fără full-text index; lipsa unui pool de conexiuni DB dimensionat.

### 12.4 Query-uri/procese potențial problematice
`FeedService.list`, `AnalyticsService.feedRankFor`, `NotificationsService.notifyAll`, cele 4 sweep-uri (toate cu bucle secvențiale după `findMany` nepaginat), `ProV2Service.searchFiles`, migrația de backfill `wallet_per_user` dacă ar rula din nou la volum mare.

### 12.5 Probleme de concurență/consistență
Soldul portofelului poate deveni negativ (citire-apoi-decrement necondiționat, fără `CHECK constraint`); contorul de cheltuială zilnică a campaniei se poate pierde sub click-uri concurente (scriere literală, nu increment); sweep-ul de refund-uri poate trimite bani dublu către Stripe sub suprapunere; numerotarea facturilor are o fereastră îngustă de coliziune la trecerea de an (eșuează sigur, dar blochează o achiziție legitimă); notificările nu au nicio constrângere de idempotență (doar flag-uri de cooldown ne-tranzacționale).

### 12.6 Probleme la Feed/„Auctions”
Nu e o licitație live — e un scor recalculat integral la fiecare cerere, fără cache/precalcul, O(n) cu numărul de companii active din categorie. Facturarea per-click e structural solidă (tranzacție, deduplicare, rollup atomic), dar cele două race condition (buget zilnic + sold portofel) înseamnă depășiri reale de buget și solduri negative reale sub volum mare de click-uri simultane.

### 12.7 Probleme la Notifications/WebSockets
Broadcast-urile platformă-largă trimit email secvențial, awaited inline, fără timeout — la 10k utilizatori practic blochează cererea și riscă limitarea contului Gmail. WebSocket-ul nu funcționează corect cu mai multe instanțe. Fiecare (re)conectare face un query DB necache-uit plus un query separat de count — un restart cu 10k clienți conectați produce un val sincronizat de query-uri. Tabelul de notificări crește nemărginit.

### 12.8 Probleme la Cron/Background Jobs
Toate cele 4 sunt `setInterval` fără lock distribuit. La o instanță, risc mic dar real pentru cele două sweep-uri orare. La mai multe instanțe (necesar pentru scalare), fiecare rulează independent — garantat să producă duplicate, cel mai grav fiind refund-urile duble trimise efectiv către Stripe.

### 12.9 Probleme la sute de categorii/subcategorii
Structura e de fapt fixă la 2 niveluri (nu recursivă în practică), deci scalează rezonabil ca date. Problema reală e de UX/admin: pagina de administrare a categoriilor e plată, fără paginare/căutare, iar selectorul de recategorisire a unei afaceri pune toate categoriile-frunză într-un dropdown fără căutare — devine nefolosibil la sute de subcategorii. Lipsește indexul compus `(status, categoryId)` pentru Feed.

### 12.10 Ce trebuie optimizat urgent
Soldul portofelului — update condiționat (`WHERE balance >= X`) sau `SELECT FOR UPDATE`, e bani reali care pot deveni negativi **azi**, nu doar la scară. Sweep-ul de refund-uri — pas de „claim” atomic înainte de a suna Stripe. Contorul de cheltuială zilnică — `increment` condiționat, nu valoare literală. Un mecanism de reconciliere pentru plăți Stripe neconfirmate. Scoaterea broadcast-urilor de notificări din calea sincronă a cererii.

### 12.11 Ce poate fi optimizat ulterior
Index compus `Company(status, categoryId)`; paginare SQL reală pentru Feed; full-text search; constrângere de idempotență pe notificări; retenție/curățare pentru notificări vechi; selector de categorii cu căutare în admin; validare de mediu mai strictă la pornire.

### 12.12 Schimbări de arhitectură pentru scalare orizontală reală
Redis (adapter Socket.IO, store rate limiter, posibil cache sesiuni); lock distribuit sau coadă reală (BullMQ+Redis) pentru cele 4 sweep-uri; o coadă de job-uri pentru apelurile AI și pentru email-urile de broadcast; PgBouncer + `connection_limit` dimensionat explicit; storage extern (S3-compatible) pentru imagini/bundle-uri; load balancer + strategie WebSocket (sticky sessions sau adapter Redis); webhook Stripe real cu verificare de semnătură și idempotență pe `event.id`.

---

*Acest document a fost produs printr-o analiză de cod, nu prin presupuneri — fiecare afirmație e ancorată într-un fișier și, unde a fost posibil, o linie concretă. Nu a fost modificat niciun cod ca parte a acestei analize.*
