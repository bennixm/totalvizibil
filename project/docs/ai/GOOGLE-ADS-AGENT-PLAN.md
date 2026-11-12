# Agent Google Ads — plan de implementare

Status: **toate fazele (0-5) complete** (2026-11-12). Agentul e complet funcțional, configurabil integral din `/admin/google-ads-agent` (credențiale, toggle, bugete, plafoane, interval per pass), cu alertare pe eșec și cost-tracking Claude. Rămâne doar: completare credențiale reale + pornire din admin pentru folosire în producție.

## Scop

Un agent care creează/administrează campanii Google Ads + grupuri de anunțuri (incl. cuvinte cheie) pe baza datelor existente pe platformă (firme active per subcategorie, trafic), și ajustează bugete/CPC. Rulează periodic, nu continuu. Orice **creștere** de buget/CPC trebuie aprobată din admin.

Claude (Anthropic API) e folosit pentru partea de judecată (alocare buget, generare keywords) — același `AiService` folosit deja de Builder.

## Decizie arhitecturală: backend intern (nu serviciu extern)

Modul nou în backend-ul NestJS existent, **nu** un serviciu separat. Motive:
- Claude e deja expus prin `AiService` în același proces (`src/ai/ai.service.ts`) — niciun beneficiu la duplicarea clientului Anthropic în altă parte.
- Datele de decizie (firme active per subcategorie, trafic, Feed CPC floor) sunt direct în Postgres-ul nostru prin Prisma.
- Credențiala Google Ads (JWT service account) e deja în `.env` și logica de auth e deja scrisă în backend (`src/google-ads/google-ads-cpc-sync.service.ts`) — de extins, nu reimplementat.
- Pagina de admin pentru aprobări are nevoie de acces direct la aceleași tabele — mai simplu în același backend.
- Volumul de muncă e mic (câteva apeluri Google Ads API + 1-2 apeluri Claude pe rulare) — nu justifică infrastructură separată.

## Ce există deja în cod (descoperit la research, de reutilizat)

- **`src/google-ads/google-ads-cpc-sync.service.ts`** — job read-only (GAQL `search`) care ține la curent CPC-ul mediu Google Ads + bookează costul zilnic ca `PlatformExpense`. Autentifică prin **service account JWT** (`google-auth-library`), apelează **direct REST-ul Google Ads** (`https://googleads.googleapis.com/v25/customers/{id}/googleAds:search`) — bypass deliberat la pachetul npm `google-ads-api` (hardcodat pe flux OAuth user-consent, incompatibil cu service account). **Nu trimite header `developer-token`** (retras din 2026-09-09; trimiterea lui ca string gol e respinsă). Acest mecanism de auth se reutilizează 1:1 pentru mutate-uri (`googleAds:mutate`), doar schimbând endpoint-ul.
- **`src/google-ads/google-ads.module.ts`** — modulul curent, doar cu `GoogleAdsCpcSyncService`.
- **`src/config/env.ts`** (linii ~56-64, ~145-156) — variabile deja existente: `googleAdsServiceAccountKeyBase64`, `googleAdsCustomerId`, `googleAdsLoginCustomerId`, `googleAdsCampaignId`.
- **`src/ai/ai.service.ts`** — `AiService.agentMessage()` (linia ~286) expune deja un apel Claude cu tool-use raw (folosit de PRO V2 `ProV2AgentService`) — mecanismul de loop agentic de reutilizat dacă e nevoie. Pattern-ul simplu `anthropicJson` (input determinist → JSON, vezi `serviceCopy`/`reviewCopy`) e preferat pentru pass-ul zilnic de buget (mai ieftin, mai previzibil decât un loop agentic).
- **`prisma/schema.prisma`**:
  - `Category` (linia 322) — arbore self-referencing (`parentId`); subcategoria = un `Category` leaf.
  - `Company` (linia 351) + `CompanyCategory` (many-to-many, `isPrimary`).
  - `Campaign` (linia 1112) — **ATENȚIE: ăsta e campania internă CPC** (companie → feed intern), total diferit de campaniile Google Ads externe. Nume noi obligatorii, fără coliziune.
  - `BusinessActionLog` (linia 291) — pattern de audit log de reutilizat ca model pentru logul noului agent.
  - `PlatformSetting` (linia 1359) — key/value simplu, pentru praguri/plafoane configurabile.
  - `PlatformExpense` (linia 215) — categoria `google_ads` deja scrisă zilnic de sync-ul existent.
- **`src/analytics/feed-pricing.ts`** — pricing-ul CPC intern per Feed (județ, subcategorie) — sursă de semnal pentru "cerere" dintr-o subcategorie (`feedCpcMinMinor`, numărul de competitori eligibili).
- **`docs/ai/AI-AGENTS.md`** — are deja un stub terse "Ads Agent" (Can: recommend campaigns, configure campaign parameters, optimize campaigns within defined limits) — acest fișier e versiunea detaliată a acelui stub.
- Nu există `@nestjs/schedule`, Bull, Agenda în `package.json` — pattern-ul actual pentru joburi periodice e `OnModuleInit` + `setInterval` in-process (single instanță).

## Arhitectura propusă

### Schema Prisma nouă

- **`GoogleAdsSubcategoryCampaign`** — mapare 1:1 `Category` (leaf) ↔ Campanie Google Ads + Grup de anunțuri. Câmpuri: `categoryId`, `googleCampaignId`, `googleAdGroupId`, `googleBudgetResourceId`, `status` (`active`/`paused`/`pending_creation`), `dailyBudgetMinor`, `maxCpcMinor`, `lastStructuralCheckAt`, `lastIntelligenceRunAt`.
- **`GoogleAdsAgentAction`** — audit log (echivalent `BusinessActionLog`, dar la nivel de platformă): `type` (`campaign_create`, `campaign_pause`, `campaign_resume`, `budget_increase_proposed`, `budget_increase_approved`, `budget_increase_rejected`, `cpc_adjusted`, `keywords_updated`), `categoryId`, `before`/`after` JSON, `status` (`applied`/`pending_approval`/`rejected`), `reasoning` (text Claude), `approvedByUserId`, `approvedAt`.
- **`GoogleAdsAgentRun`** — un rând per rulare: `kind` (`structural`/`intelligence`), `startedAt`/`finishedAt`, `categoriesScanned`, `actionsTaken`, `actionsPendingApproval`, `claudeCostEstimate`, `status`, `errorSummary`. Folosit și ca lock (rând `in_progress` unic) ca să nu ruleze de două ori în paralel.

### Două cadențe de execuție

**(A) Pass structural — fără Claude, la 6 ore**, pur determinist:
- 0 firme active într-o subcategorie → `pause` campanie/grup.
- ≥1 firmă activă, fără mapare → `create` schelet campanie + grup (buget minim implicit).
- ≥1 firmă activă, mapare `paused` → `resume`.
Se aplică direct, fără aprobare (reversibil, fără bani noi).

**(B) Pass de inteligență bugetară — cu Claude, o dată pe zi** (recomandat 03:00, fereastră de trafic minim):
- Se adună determinist per subcategorie: nr. firme (+ trend), volum trafic/click-uri, Feed CPC floor curent, buget/CPC/status curent.
- **Un singur apel Claude, batch pe toate subcategoriile** (nu un apel per subcategorie) — Claude vede tot portofoliul și poate realoca relativ între subcategorii. Pattern `anthropicJson`, model fast (sonnet), efort `medium`.
- Claude răspunde cu propuneri: `proposedDailyBudgetMinor`, `proposedMaxCpcMinor`, `reasoning` per subcategorie.
- **Regula de aplicare (cerința de aprobare):**
  - **Scădere** buget/CPC → se aplică automat.
  - **Creștere** buget/CPC → scrisă ca `GoogleAdsAgentAction` cu `status: pending_approval`; NU se trimite la Google Ads până la aprobare manuală din admin.
  - Garduri dure din `PlatformSetting` (plafon buget total platformă, CPC maxim absolut) — Claude nu poate propune peste ele.
- Generarea de **cuvinte cheie**: apel Claude separat, o singură dată la creare (sau regenerare manuală din admin), nu zilnic — pattern `serviceCopy` (input determinist → JSON).

### Clientul Google Ads

Extrage logica de auth/REST din `GoogleAdsCpcSyncService` într-un serviciu partajat `GoogleAdsApiClient`, folosit de sync-ul existent (search) ȚI de agentul nou (search + mutate: `Campaign`, `CampaignBudget`, `AdGroup`, `AdGroupCriterion` pentru keywords, `campaign.status`). Același bearer token JWT, același endpoint REST, doar `googleAds:mutate` în loc de `googleAds:search`.

### Mecanism de scheduling

**Decizie revizuită în Faza 2** (planul inițial propunea `@nestjs/schedule`): codul existent nu folosește NICIUNDE `@nestjs/schedule`/Bull/Agenda — peste tot (ex. `GoogleAdsCpcSyncService`, `NotificationsSweepService`) pattern-ul e `OnModuleInit` + `setInterval`, in-process, o singură instanță. Ca să nu introducem o dependență nouă fără beneficiu real (single-instance deploy, fără Redis) și ca să rămânem consistenți cu restul codului, **`GoogleAdsAgentStructuralService` folosește exact același `OnModuleInit` + `setInterval`**, nu `@nestjs/schedule`. Lock prin `GoogleAdsAgentRun` (rând `in_progress` unic, cu recuperare automată la lock "stale" >30 min) ca să nu ruleze de 2 ori la redeploy. Buton "Run now" în admin (Faza 4) va apela direct metoda publică `run()`.

Respins: cron de sistem extern (adaugă auth inter-sisteme fără beneficiu pe o singură instanță), queue/Bull (overkill pentru un job de câteva secunde), `@nestjs/schedule` (dependență nouă fără beneficiu peste `setInterval`, inconsistent cu restul codului).

### Pagina admin — `/admin/google-ads-agent`

Pattern existent: `AdminDetailHeader` + `v-tabs` + `AdminSection`/`AdminStatCard`/`AdminEmptyState`.

1. **Prezentare generală** — campanii active, buget zilnic total, cheltuială azi/luna (din `PlatformExpense` categoria `google_ads`), subcategorii fără prezență Google Ads, status/timp ultima + următoarea rulare.
2. **Propuneri în așteptare** — tabel `GoogleAdsAgentAction` (`pending_approval`): subcategorie, buget/CPC curent vs. propus, delta %, raționamentul Claude, Aprobă/Respinge (+ bulk).
3. **Campanii & grupuri de anunțuri** — tabel `GoogleAdsSubcategoryCampaign`: subcategorie, ID campanie/grup, status, buget, CPC maxim, nr. firme, link către Google Ads UI.
4. **Istoric / Loguri** — `GoogleAdsAgentAction` complet, filtrabil după subcategorie/dată/tip.
5. **Setări agent** — on/off global, praguri auto-aprobare (implicit 0 — totul cu creștere cere aprobare), plafon global buget/CPC, "Run now" per cadență.

## Decizii ACCEPTATE (2026-11-09)

1. **Granularitate campanie**: **1 Campanie Google Ads + 1 Grup de anunțuri per subcategorie** (leaf `Category`), fiecare cu propriul `CampaignBudget` — control independent al bugetului/CPC per subcategorie.
2. **Targetare geografică**: campaniile Google Ads targetează **la nivel național per subcategorie**, NU per județ (ar exploda numărul de campanii: 42 județe × N subcategorii). Distribuția pe județ rămâne un concept intern de pricing/ranking (Feed), separat de targetarea Ads.

## Faze de implementare (de urmat în ordine)

- **Faza 0** — ✅ FĂCUT (2026-11-11). Schema Prisma (3 tabele: `GoogleAdsSubcategoryCampaign`, `GoogleAdsAgentAction`, `GoogleAdsAgentRun` + enum-urile lor) adăugată în `prisma/schema.prisma` (secțiune nouă, după `BusinessActionLog`, înainte de `Taxonomy`/`Category`). Relații înapoi adăugate pe `Category` (`googleAdsCampaign`, `googleAdsAgentActions`) și `User` (`googleAdsActionsApproved`). Migrare `20261111192334_add_google_ads_agent_tables` generată și aplicată pe DB local. Verificat: `prisma format` + `prisma validate` OK, `tsc --noEmit` pe tot backend-ul fără erori. Encă nu există niciun serviciu/modul care să scrie în aceste tabele — doar schema.
- **Faza 1** — ✅ FĂCUT (2026-11-11). `GoogleAdsApiClient` nou (`src/google-ads/google-ads-api-client.service.ts`) — transport generic: auth JWT (identic cu cel vechi), `search()` (GAQL) și `mutate()` (atomic, `partialFailure: false`, suportă temporary resource-name ids pentru a înlănțui create-uri în același apel — ex. `campaignBudgetOperation`/`campaignOperation`/`campaignCriterionOperation`/`adGroupOperation`/`adGroupCriterionOperation`). `GoogleAdsCpcSyncService` refactorizat să folosească clientul (comportament identic, verificat prin teste). `GoogleAdsModule` exportă `GoogleAdsApiClient`. 16 teste noi (`test/google-ads/`) + toată suita existentă (77 suites / 1016 teste) trece. **Decis a NU se rezolva în Faza 1** (ca să nu se ghicească date): ID-ul geo-target-constant pentru România și conversia credite→micros per valuta contului — rămân subiect explicit pentru Faza 2, de rezolvat cu un lookup GAQL live (`geo_target_constant`), nu hardcodat.
- **Faza 2** — ✅ FĂCUT (2026-11-11). Pass-ul structural (`src/google-ads/google-ads-agent-structural.service.ts`), fără Claude, `OnModuleInit` + `setInterval` la 6h (vezi decizia de scheduling de mai sus — NU `@nestjs/schedule`). Reguli determinist aplicate: 0 firme active → pauză; ≥1 firmă activă + fără mapare → creează schelet (buget + campanie PAUSED + targetare geo RO + targetare limbă RO + grup de anunțuri ENABLED, dar FĂRĂ cuvinte cheie/reclame — deci zero risc de cheltuială până la Faza 3); ≥1 firmă activă + mapare `paused` → reactivează. Toate cele 3 acțiuni scrise ca `GoogleAdsAgentAction` (`status: applied`, fără aprobare — motivat în comentariul clasei: reversibile/fără bani noi). Lock prin `GoogleAdsAgentRun` cu recuperare la lock stale (>30 min).
  - **Rezolvate exact cum cerea Faza 1** (fără date ghicite): `GoogleAdsReferenceDataService` (`src/google-ads/google-ads-reference-data.service.ts`) face lookup GAQL live pentru `geo_target_constant` (RO, country) și `language_constant` (cod `ro`), plus `customer.currency_code`, toate cache-uite 24h în memorie (throw explicit dacă lookup-ul nu găsește nimic, niciun fallback hardcodat). `creditsToAmountMicros()` (`src/google-ads/google-ads-money.ts`) convertește credite → `amountMicros` în valuta reală a contului (EUR/RON, oglindă a `GoogleAdsCpcSyncService.toCredits()`, throw pe valută neacoperită). `subcategoryLandingPath()`/`subcategoryLandingUrl()` (`src/google-ads/google-ads-landing-url.ts`) construiesc URL-ul `/grup/nisa` identic cu rutarea SEO reală a frontend-ului (`feedCategoryRoute()` din `services/routes.ts`) — nu e încă folosit în niciun mutate (ad-urile/cuvintele cheie vin în Faza 3), dar e pregătit și testat.
  - Setări noi în `PlatformSettingsService`: `googleAdsAgentEnabled` (implicit OFF — agentul nu face NIMIC până nu e pornit manual din admin), `googleAdsAgentDefaultDailyBudgetCredits` (implicit 5 credite), `googleAdsAgentDefaultMaxCpcCredits` (implicit 1 credit) — folosite doar la creare schelet; sigur de aplicat fără aprobare pentru că schelet-ul e PAUSED și fără reclame.
  - "Firmă activă într-o subcategorie" = exact filtrul folosit de feed-ul public (`FeedService`: `Company.status = 'active'` + `CompanyCategory`), verificat direct în cod, ca agentul să nu promoveze/pauzeze pe baza unui semnal diferit de ce vede efectiv un vizitator.
  - 24 teste noi (`test/google-ads/google-ads-agent-structural.service.spec.ts`, `google-ads-reference-data.service.spec.ts`, `google-ads-money.spec.ts`, `google-ads-landing-url.spec.ts` + teste adăugate în `platform-settings.service.spec.ts`) + toată suita existentă trece (verificat după, zero regresii).
- **Faza 3** — ✅ FĂCUT (2026-11-11). Două servicii noi, separate (fiecare `OnModuleInit` + `setInterval`, nu `@nestjs/schedule` — aceeași decizie ca Faza 2):
  - **`GoogleAdsAgentContentService`** (`src/google-ads/google-ads-agent-content.service.ts`), la 6h: scanează toate mapările `pending_creation`, cere lui Claude (metodă nouă `AiService.googleAdsKeywordPlan()`) cuvinte cheie (8-15) + reclamă RSA (headlines ≤30 caractere, descriptions ≤90 caractere), validează server-side minimele reale ale Google Ads (≥3 keywords/headlines, ≥2 descriptions — sub acestea întoarce `null`, NU trimite un mutate sortit eșecului). Dacă planul e valid: scrie cuvintele cheie (`adGroupCriterionOperation`, match type PHRASE) + reclama (`adGroupAdOperation`, `finalUrls` = `subcategoryLandingUrl()`) + activează campania (`campaignOperation.update status=ENABLED`) într-UN singur mutate atomic, abia apoi trece mapping-ul local pe `active`. **Nu există altă cale către `active`** — o campanie creată de agent nu poate ajunge activă fără reclame reale.
  - **`GoogleAdsAgentIntelligenceService`** (`src/google-ads/google-ads-agent-intelligence.service.ts`), 1x/zi (verificare la fiecare 10 min dacă ora UTC curentă = ora țintă ȚI nu s-a rulat deja azi — nu o oră fixă exactă din cauza DST, documentat în cod): adună per subcategorie `active` nr. firme active + buget/CPC curent, plus pragul global CPC minim din Feed (`feedCpcMinMinor`) — UN apel Claude batch (`AiService.googleAdsBudgetIntelligence()`) peste tot portofoliul. **Regula de aprobare aplicată strict**: orice propunere unde buget SAU CPC maxim CREȘTE față de valoarea curentă → scrisă `GoogleAdsAgentAction` cu `status: pending_approval`, action `budget.increase.proposed`, NIMIC trimis la Google Ads. O propunere unde ambele scad (sau rămân egale) → aplicată imediat (`action: cpc.adjusted`, `status: applied`). **Fiecare propunere e clamp-uită server-side** la plafoanele admin (`googleAdsAgentMaxDailyBudgetCapCredits`/`googleAdsAgentMaxCpcCapCredits`, setări noi, implicit 50 / 5 credite) — Claude nu e niciodată singura linie de apărare. `approveProposal(actionId, userId)`/`rejectProposal(actionId, userId)` (metode de serviciu, fără endpoint HTTP încă — vin în Faza 4) — aprobarea trimite mutate-ul real abia acum; respingerea nu trimite niciodată nimic la Google Ads.
  - Metode noi publice pe `AiService`: `googleAdsKeywordPlan()`, `googleAdsBudgetIntelligence()` — ambele `null` pe eroare/indisponibil (niciodată date fabricate ca fallback).
  - Enum `GoogleAdsAgentRunKind` extins cu `content` (migrare `20261111221342_add_google_ads_content_run_kind`, `ALTER TYPE ... ADD VALUE` — aditiv, fără risc).
  - Tip nou `adGroupAdOperation`/`adGroupAdResult` adăugat în `GoogleAdsApiClient` (pentru reclama RSA).
  - 48 teste noi (`test/ai/ai.service.google-ads.spec.ts`, `test/google-ads/google-ads-agent-content.service.spec.ts`, `test/google-ads/google-ads-agent-intelligence.service.spec.ts`) + toată suita existentă trece.
  - **Omis deliberat din v1** (notat ca lipsă cunoscută, nu bug): semnalul de "trend" nr. firme (ar necesita un nou tabel de istoric/snapshot zilnic) și metrici reale de performanță per-campanie Google Ads (clicuri/conversii) ca input pentru Claude — v1 se bazează doar pe nr. firme active curent + bugetul/CPC curent + pragul CPC Feed. De revizuit dacă se dovedește insuficient în practică.
- **Faza 4** — ✅ FĂCUT (2026-11-11). Backend: `AdminGoogleAdsController` nou (`src/admin/admin-google-ads.controller.ts`, `@Controller('admin/google-ads-agent')`, `@PlatformRoles('admin')` — strict admin, nu lărgit la `finance` ca restul paginii de settings) + `AdminGoogleAdsService` (agregări, nu logică de decizie — aceea rămâne în cele 3 servicii de agent). Endpoint-uri: `GET overview` (status agent, nr. campanii per status, buget zilnic total, cheltuială azi/lună din `PlatformExpense`, subcategorii fără campanie, ultima rulare per cadență), `GET proposals` + `POST proposals/:id/approve|reject` (scrie și în `AdminAuditLog`, pe lângă `GoogleAdsAgentAction.approvedByUserId`), `GET campaigns` (+ nr. firme active per campanie), `GET actions` (istoric, filtrabil status/acțiune/dată, paginat), `POST run/:kind` (trigger manual pentru orice cadență). Cele 5 setări noi ale agentului (`googleAdsAgentEnabled` + cele 4 de buget) sunt expuse prin endpoint-ul GENERIC existent `GET/PATCH /admin/settings` (reutilizat, nu duplicat) — pagina nouă le citește/scrie de acolo.
  Frontend: `AdminGoogleAdsAgentView.vue` nou (`/admin/google-ads-agent`, link în sidebar doar pentru `admin`), 5 tab-uri (Prezentare generală + Run-now per cadență, Propuneri în așteptare + Aprobă/Respinge cu confirmare, Campanii & grupuri, Istoric cu filtre, Setări agent). Store nou `useAdminStore` extins cu secțiunea `googleAdsAgent*` (fetch/mutate, același pattern ca restul magazinului admin). i18n complet RO/EN/DE (namespace `adminGoogleAds` + `admin.navGoogleAdsAgent`). Verificat: `vue-tsc --noEmit`, `eslint`, `vite build` — toate curate.
  19 teste noi (`test/admin/admin-google-ads.service.spec.ts` + 2 setări noi testate în `platform-settings.service.spec.ts`) + toată suita existentă (85 suite / 1081 teste) trece.
- **Faza 5** — ✅ FĂCUT (2026-11-12). Alertare: `src/google-ads/google-ads-agent-alerts.ts` (`notifyAdminsOfFailedGoogleAdsAgentRun`, niciodată nu aruncă) trimite o notificare in-panel fiecărui admin (`platformRoleAssignment` role `admin`) de fiecare dată când orice pass termină `status: failed` (atât eșec neașteptat cât și "Claude indisponibil") — tip nou `google_ads_agent_run_failed`, înregistrat și în `stores/notifications.ts` (icon + link direct către `/admin/google-ads-agent`). Cost tracking: `AiService.anthropicJson` a fost separat într-un wrapper + o metodă nouă `anthropicJsonWithUsage` (comportament identic pentru `serviceCopy`/`reviewCopy`, zero risc), `estimateClaudeCostMinor()` (export nou, tarif Sonnet $2/$10 per MTok, 1 credit≈$1 — explicit doar estimare, nu facturare reală) e scris în `GoogleAdsAgentRun.claudeCostEstimateMinor` de ambele pass-uri care folosesc Claude.
- **Extins față de plan în timpul Fazei 4/5** (la cererea utilizatorului): panoul de admin poate seta ACUM TOT, nu doar bugetele/toggle-ul:
  - **Cont Google Ads din DB, nu doar `.env`**: `PlatformSettingsService` are 4 setări noi (`googleAdsCustomerId`, `googleAdsLoginCustomerId`, `googleAdsCampaignId`, `googleAdsServiceAccountKeyBase64` — validată la salvare). `GoogleAdsApiClient` a fost refactorizat din "construit sincron o dată la boot" în `OnModuleInit` + poll la 60s care re-citește din DB (prioritate) cu fallback pe env — deci o schimbare din admin se activează fără restart. Cheia de serviciu NU e niciodată întoarsă către frontend (endpoint dedicat `GET/PATCH /admin/google-ads-agent/credentials`, mascat — doar `serviceAccountKeyConfigured`+`serviceAccountEmail`).
  - **Interval configurabil per pass**: cele 3 servicii de agent au fost rescrise de la `setInterval` cu perioadă fixă la un poll scurt fix (5-10 min) + un `isDue()` care compară `Date.now()` cu ultima rulare din `GoogleAdsAgentRun` + un interval citit live din `PlatformSettingsService` (`googleAdsAgentStructuralIntervalMinutes`/`ContentIntervalMinutes`/`IntelligenceIntervalMinutes`, admin-settable din tab-ul Setări). Asta a simplificat și pass-ul de inteligență (a renunțat la "doar la ora 1 UTC" în favoarea aceleiași logici uniforme).
  - Bug reparat din Faza 3: pass-ul de conținut nu verifica deloc `googleAdsAgentEnabled` — acum o face, la fel ca celelalte 2.
  - Toate cele 3 servicii primesc acum și `NotificationsService` (pentru alertare).
  - Teste noi pentru tot ce e de mai sus (credențiale mascate, interval elapsed/not-elapsed, alertare, cost tracking) — suita completă: 86 suite / 1105 teste, toate verzi.

## Analiză DeepSeek (hibrid de cost) — 2026-11-12

Concluzie: **nu recomand un hibrid DeepSeek pentru acest agent.** Motivul central: costul Claude actual e deja neglijabil, pentru că volumul de apeluri e structural limitat (nu per-utilizator/per-mesaj ca la PRO V2, ci per-subcategorie creată vreodată + 1 apel batch/zi), nu pentru că modelul e ieftin.

- **Plan cuvinte cheie** (`googleAdsKeywordPlan`, o dată per subcategorie nouă): ~600 tokeni input + ~700 output pe Sonnet ($2/$10 per milion) ≈ **$0.008/apel**. La 150 subcategorii, cost total ÎNTR-O VIAȚĂ ≈ $1-2.
- **Pass de buget** (`googleAdsBudgetIntelligence`, 1x/zi implicit, batch): la ~100 subcategorii active, ≈ $0.045/rulare ≈ **$16/an**. La o platformă mai mică (~20 subcategorii), ≈ $5/an.
- **Total actual estimat: sub $20/an**, indiferent de scară rezonabilă pentru acest produs.

DeepSeek (`deepseek-flash` $0.15/$1.2 per milion, `deepseek-v4-pro` ~$1.32/$3.96 per milion, prețuri de vârf) ar reduce acest total cu **~$10-15/an** — bani reali, dar triviali comparativ cu bugetul de publicitate Google Ads propriu-zis pe care agentul îl gestionează.

Recomandare pe sub-apel:
1. **Pass-ul de buget (`googleAdsBudgetIntelligence`) rămâne EXCLUSIV pe Claude.** E cel mai important apel din tot agentul — alocă bani reali pe tot portofoliul, 1x/zi, deci costul e deja minim; riscul unei decizii proaste pe un model mai slab poate costa mult mai mult în reclame greșit alocate decât orice s-ar economisi la API.
2. **Plan cuvinte cheie/reclamă** — candidat teoretic pentru un hibrid (gen pattern-ul `ModelRouter` din PRO V2: `deepseek-flash` întâi, escaladare la Claude dacă rezultatul nu trece validările minime deja existente), dar economia e de ordinul a 1-2 dolari TOTAL, niciodată recurentă. Nu am implementat — dacă vrei totuși consistența cu PRO V2 sau vrei să testezi calitatea DeepSeek pe acest tip de copy, e un adaos mic și izolat (nu afectează pass-ul de buget).

Dacă bugetul de reclame al platformei crește mult (ex. mii de subcategorii, regenerări frecvente), reanalizează — dar la scara actuală, complexitatea unui al doilea provider AI nu se justifică.

## Cum se pornește agentul în producție (recapitulare, nu de reverificat)

1. Configurează `GOOGLE_ADS_SERVICE_ACCOUNT_KEY_BASE64` / `GOOGLE_ADS_CUSTOMER_ID` / `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (deja existente din sync-ul vechi) + `ANTHROPIC_API_KEY` (deja existent, shared cu builder-ul).
2. Din `/admin/google-ads-agent` → tab "Setări agent" → pornește comutatorul `googleAdsAgentEnabled` (implicit OFF) și ajustează bugetele implicite/plafoanele dacă e nevoie.
3. De acolo încolo: pass-ul structural (6h) creează scheletele + pauzează/reactivează; pass-ul de conținut (6h) le activează cu reclame reale; pass-ul de inteligență (1x/zi) propune ajustări de buget — creșterile apar în tab-ul "Propuneri în așteptare" pentru aprobare manuală.

## Note de cost/interval (raționament, nu de reverificat)

- Firmele active/trafic per subcategorie = semnal lent (zile, nu ore) → pass de inteligență 1x/zi e suficient; mai des ar consuma tokeni Claude fără informație nouă și ar genera prea multe cereri de aprobare.
- Pass structural la 6h e suficient de rapid pentru reacție la subcategorii goale/populate, și e gratuit (fără Claude).
- 1 apel Claude/zi, batch pe toate subcategoriile, cost negligibil (zeci de KB JSON, model fast, efort mediu).
