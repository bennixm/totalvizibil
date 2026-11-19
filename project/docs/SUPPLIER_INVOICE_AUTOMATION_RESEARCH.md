# Supplier invoice automation: research, architecture, roadmap

Status: research + first implementation (2026-11-19). Scope: the invoices **our company receives** from the providers we pay (not the invoices the platform issues to customers).

**How to read the sources.** Every external fact is tagged:

- **[V]** verified on the official page listed next to it (read on 2026-11-19).
- **[V-live]** verified by a real call from this codebase.
- **[U]** UNVERIFIED: the official page could not be read from this environment, or the fact comes from general knowledge. Confirm it before building on it.

No endpoint, price or capability below is invented. Where nothing could be verified, the document says so instead of filling the gap.

---

## 1. What the platform pays for today (codebase audit)

Every outbound integration found in `project/backend` (env config + every external API host in `src/`):

| Provider | Used for | Cost to us | Invoice access found |
|---|---|---|---|
| **Google Ads** | Campaigns (service account, REST v25) | Ad spend, monthly | **API exists** (InvoiceService). See 2.1 |
| **Anthropic (Claude API)** | AI builders, feed search, invoice extraction | Token usage | No invoice API. See 2.2 |
| **DeepSeek** | PRO V2 model router | Token usage | No invoice API. See 2.3 |
| **Stripe** | Customer payments | Fees per payment | No API for Stripe's own fee invoices. See 2.4 |
| **Pexels** | Stock photos | Free | n/a |
| **SMTP provider** | Transactional e-mail | Subscription | Unknown provider (only host/credentials in config) |
| **VPS hosting** | Production server | Subscription | Unknown provider (deploy uses `secrets.VPS_HOST`) |
| **Domain registrar** | Not integrated yet (`StubDomainRegistrarProvider`) | n/a | n/a |
| **Google Cloud** (service account project) | Auth for Google Ads | Usually none | Not investigated |

---

## 2. Provider by provider

### 2.1 Google Ads

- **Method:** InvoiceService `ListInvoices`: `GET /v{N}/customers/{customerId}/invoices?billingSetup=…&issueYear=yyyy&issueMonth=JANUARY…`, then an authenticated GET on each invoice's `pdf_url` with the same account's Bearer token. **[V]** https://developers.google.com/google-ads/api/docs/billing/invoice
- **Requirements:** monthly invoicing must be enabled. Invoices before 2019-01-01 can't be requested. `login-customer-id`, when set, must be the paying manager. **[V]** same page.
- **Fields:** id, type, issue/due date, service date range, currency, subtotal/tax/total in micros, corrected/replaced invoices, `pdf_url`. **[V]**
- **Live result on our account:** the account has 2 billing setups (one APPROVED, one PENDING). `ListInvoices` answers **HTTP 403 `DEVELOPER_TOKEN_NOT_APPROVED`**, while `search`/`mutate` work without a developer token. **[V-live]** So the integration is built and tested with stubs, but Google refuses invoice access at our current API access level.
- **Other options:** the Google Ads UI "Invoices overview" lists monthly invoices, credit/debit memos and tax documents, with bulk download. Monthly invoices are "typically finalized by the 5th to 7th business day of the month". **[V]** https://support.google.com/google-ads/answer/13258491
- **E-mailing invoices to billing contacts:** **[U]** not stated on the pages read.
- **Automation:** full, once API access is approved. Until then, manual upload; a later API import links to the uploaded row by invoice number.

### 2.2 Anthropic (Claude API)

- **Admin API:** usage and cost only, via `GET /v1/organizations/analytics/usage` and `/analytics/cost` (USD amounts per row). No invoice or receipt endpoint. Admin resources are members, invites, workspaces, API keys and service accounts. **[V]**
  - https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api.md
  - https://platform.claude.com/docs/en/manage-claude/admin-api
- **Original invoices:** downloadable from the Console billing settings. **[U]** for the exact path, and **[U]** whether they are also e-mailed to billing contacts.
- **Cost data** could be imported for reconciliation. It is **usage, not an invoice**, and must never be shown as one.
- **Automation:** not possible through the API → manual upload, or e-mail ingestion if Anthropic e-mails invoices **[U]**.

### 2.3 DeepSeek

- **API reference:** chat completions, responses, messages, FIM, models, user balance, files, tools. **No invoice or billing-document endpoint.** **[V]** https://api-docs.deepseek.com/
- **Invoice delivery:** **[U]**.
- **Automation:** manual upload (or e-mail ingestion, if delivered by e-mail **[U]**).

### 2.4 Stripe

- Stripe fees per payment are already captured automatically as expenses (`source = stripe_api`, existing code).
- **Stripe's own fee invoices / tax invoices:** both candidate official pages returned 404 from this environment. **[U]** Whether they are e-mailed, downloadable from Dashboard → Documents, or exposed by any API.
- **Automation:** manual upload until verified.

### 2.5 Hosting, SMTP, domains

The provider isn't identifiable from code. Most hosting/e-mail providers e-mail a PDF invoice monthly **[U]**, so **e-mail ingestion (section 3)** is the generic way to automate them.

---

## 3. E-mail ingestion (the generic automation path)

Goal: one dedicated mailbox (e.g. `facturi@…`) that every provider without an API sends invoices to. PDF/XML attachments are picked up and fed into the same pipeline.

### 3.1 Gmail / Google Workspace

All points below are **[V]** on https://developers.google.com/workspace/gmail/api/guides/push unless another page is given.

- **Push:**
  - `POST /gmail/v1/users/me/watch` with a Cloud Pub/Sub `topicName`, optional `labelIds` and `labelFilterBehavior`.
  - Grant publish on the topic to `gmail-api-push@system.gserviceaccount.com`.
  - The response holds `historyId` and `expiration`.
- **Renewal:** "You must call the watch method at least once every 7 days … We recommend calling watch once per day."
- **Notification payload:** base64url JSON `{emailAddress, historyId}`. It carries no message content. Fetch changes with `history.list(startHistoryId=…)`.
- **Limits and fallback:** max "one event per second" per user. Notifications can be delayed or dropped "in rare situations", so the page recommends a periodic `history.list` fallback.
- **Attachments:** `GET https://gmail.googleapis.com/gmail/v1/users/{userId}/messages/{messageId}/attachments/{id}`. Accepted scopes include `gmail.readonly`, `gmail.modify` and `mail.google.com`. **[V]** https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get
- **Compliance:** `gmail.readonly` is a **restricted scope**. A public app needs restricted-scope verification plus an **annual CASA security assessment** if data is stored server-side. **[V]**
  - https://developers.google.com/workspace/gmail/api/auth/scopes
  - https://support.google.com/cloud/answer/13465431
  - https://support.google.com/cloud/answer/9110914
- **Internal-only Workspace apps:** whether they are exempt is **[U]**. Check https://support.google.com/cloud/answer/13464323 first. If our own Workspace domain qualifies, this is the cheapest route.

### 3.2 Microsoft 365 / Outlook (Graph)

- **Subscriptions** on `/users/{id}/mailFolders('inbox')/messages`:
  - max lifetime "10,080 minutes (under seven days)", or "1440 minutes" with resource data;
  - renew via update;
  - `clientState` validation;
  - lifecycle notifications.

  **[V]** https://learn.microsoft.com/en-us/graph/api/resources/subscription and https://learn.microsoft.com/en-us/graph/change-notifications-overview
- **Attachments:** `GET /users/{id}/messages/{id}/attachments/{id}/$value` gives the raw bytes. Permission `Mail.Read`, delegated or application. **[V]** https://learn.microsoft.com/en-us/graph/api/attachment-get
- **Gaps:** the validation-token handshake and payload schema were not read. **[U]**

### 3.3 IMAP

A fallback for mailboxes on any host (e.g. the same SMTP provider). It needs polling or IMAP IDLE and stores a mailbox password, so it is more fragile and less secure than OAuth. Use it only if the mailbox is not Google or Microsoft.

### 3.4 Recommendation

1. A dedicated invoices mailbox.
2. Gmail push if it's Workspace (cheap and real-time, once compliance is clear), else Graph, else IMAP IDLE.
3. Each e-mail goes to the attachments, then to the pipeline (section 6).
4. Ask every provider to send invoices to that address.

---

## 4. E-invoicing networks

### 4.1 RO e-Factura (ANAF), the most important source for Romanian suppliers

- **Why it matters:** domestic B2B invoices issued by Romanian suppliers go through ANAF's SPV. Receiving them via API would automate **every Romanian supplier at once**, without per-supplier integrations.
- **What could not be verified:** the official pages refused connections from this environment (ECONNREFUSED):
  - https://mfinante.gov.ro/ro/web/efactura/informatii-tehnice
  - https://static.anaf.ro/static/10/Anaf/Informatii_R/API/Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf

  So every detail here is **[U]**:
  - the message list and download endpoints;
  - OAuth2 with a qualified digital certificate and its token lifetime;
  - the XML format (RO_CIUS on UBL 2.1 / CII);
  - an XML→PDF conversion service;
  - rate limits;
  - mandatory dates.
- **Recommendation:** read those two pages from a Romanian connection and confirm the above before implementation. The codebase already accepts XML originals (UBL), and `ExternalInvoiceSource.efactura` is reserved.

### 4.2 Peppol

- **Peppol** is a framework, not a portal. "Any organisation can send and receive business documents across the Peppol Network via their chosen Peppol-accredited Service Provider" (four-corner model). **[V]** https://peppol.org/about/
- **Certified Service Providers** are listed with Access Point / SMP status. German providers list **KoSIT** as their Peppol Authority. **[V]** https://peppol.org/members/peppol-certified-service-providers/
- **Romanian providers on that list** (e.g. Docprocess, PROFLUO, KPMG Advisory): **[U]**, because that part of the page was only partially read.
- **Receiving via API:** done through the chosen Service Provider's API (webhook or pull). Storecove's docs need a login, so **[U]**. Compare 2–3 providers' public API docs and prices before choosing.

### 4.3 EN 16931 / formats

- **EN 16931-1 version 2026** was published in May 2026, and the 2017 version was formally withdrawn. The 2017 version stays compliant during migration. **[V]** https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/Obtaining+a+copy+of+the+European+standard+on+eInvoicing
- **Syntax bindings:** UBL 2.1 (Part 3-2) and UN/CEFACT CII D16B (Part 3-3). **[V]** same page.
- **ZUGFeRD / XRechnung** are CII/UBL profiles. Format details are **[U]** here.

### 4.4 Germany (E-Rechnung)

Relevant only if the company operates in Germany. The BMF FAQ returned HTTP 503: https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html. The receiving obligation date and transition periods are **[U]**; re-check them there.

---

## 5. AI invoice extraction

| Option | Status | Notes |
|---|---|---|
| **Claude API** (implemented) | PDF/image input + structured outputs (`output_config.format` JSON schema), fast model tier (`ANTHROPIC_MODEL_FAST`) | Costs follow token pricing in the Claude API docs. The estimate is stored per invoice (`extraction.estimatedCostUsd`). **The local `.env` key is currently rejected (401 invalid x-api-key) [V-live]**, so a real extraction still has to be tested with a valid key. |
| **Google Document AI Invoice Parser** | Not implemented | Price, regions (EU) and field list are **[U]**: the pricing page returned no content and the docs redirected to `docs.cloud.google.com`, which was blocked. Check https://docs.cloud.google.com/document-ai/pricing and the processors list. |
| **Other OCR** (Azure Document Intelligence, AWS Textract, Mindee…) | Not researched | **[U]** |

**Rules applied in code:**

- AI output is a **draft**: per-field confidence is shown, low-confidence fields are highlighted, and the invoice stays **"needs review"** until a person ticks "I checked the data against the original".
- The extraction never invents values; the prompt requires `null` when a value isn't printed.
- Structured XML (e-Factura/UBL, CII) is parsed deterministically (`einvoice-xml.ts`): no AI, no cost, exact values. Such uploads don't need the "I checked" confirmation.

---

## 6. Architecture

### 6.1 Pipeline

```
SOURCE ADAPTER ─► INGEST ─► DOCUMENT STORAGE ─► EXTRACTION ─► VALIDATION ─► DUPLICATE CHECK ─► DB ─► DASHBOARD
 (google_ads,      (ExternalInvoicesService.ingest)    (AI draft or     (validateInvoice) (externalId,     (+ events,
  upload; next:     original kept in                    structured       totals, VAT,      normalized no.,  notifications)
  email, efactura,  ExternalInvoiceDocument,            provider data)   dates)            near-duplicate)
  peppol)           data in ExternalInvoice
```

**Implemented:**

- `sources/invoice-source.ts`: the `InvoiceSourceAdapter` interface (`collect`, `refetchDocuments`).
  - Google Ads is the first adapter (`sources/google-ads.source.ts`).
  - A new source means a new file. Storage, validation, dedup, history and notifications are shared in `ingest()`.
- **Original vs extracted data:**
  - the original document is stored separately (`external_invoice_documents`);
  - structured fields live in `external_invoices`;
  - extra files go to `external_invoice_attachments`.
- **Common data model:**
  - supplier, VAT id, number, type, issue/due dates, period, currency;
  - net/VAT/total, VAT per rate, lines;
  - payment status/date, processing status, source;
  - extraction metadata, raw provider payload.
- **Validation** (`external-invoice-model.ts`):
  - net + VAT = total;
  - VAT breakdown and lines sum checks;
  - date order and issue date in the future;
  - paid without date, missing number.

  Any failed check sends the invoice to **needs review**.
- **Duplicates:**
  - same provider id (re-import updates, never duplicates);
  - same supplier + invoice number written differently (`FV-0042` = `fv 0042`), refused on upload, linked on import;
  - near-duplicate: same supplier + currency + total within ±3 days, flagged.
- **Manual corrections:**
  - recorded as from→to in `external_invoice_events`, plus the global audit log;
  - never overwritten by later automatic imports.
- **Retry:**
  - per-invoice document fetch failures are kept (`documentError`) and retried on every sync;
  - per-month API failures are counted, and the sync is ok only if some calls succeed.
- **Notifications** to admin + finance staff:
  - new automatic imports;
  - due within 3 days and overdue, once per invoice per stage.
- **Scheduling:** `setInterval` (daily sync, reminders every 6 h), the same pattern the rest of the backend uses.

**Not implemented (needs infra):**

- a real queue (BullMQ needs Redis; there is none today);
- webhook endpoints for Gmail/Graph push;
- an OAuth connection store for mailboxes.

### 6.2 Recommended additions before e-mail / e-Factura

1. **Job table or queue:**
   - option A: a `ingestion_jobs` table polled by a worker, with no new infra;
   - option B: Redis + BullMQ.

   Each job is source + payload ref + status + attempts + next_run_at, retried with exponential backoff.
2. **Raw inbox table:** keep every received e-mail/XML as received before extraction, for reprocessing and audit.
3. **Encrypted credential store** for mailbox OAuth refresh tokens and the e-Factura certificate token.
4. **Supplier registry** (section 7.1) to map sender e-mail / VAT id → supplier automatically.

---

## 7. Additional features: status and proposals

| # | Feature | Status |
|---|---|---|
| 1 | **Supplier management** (registry: name, VAT id, e-mails, payment terms, default currency) | **Implemented.** `external_suppliers` rows are created automatically at ingestion (provider + normalized name, VAT-id fallback). VAT id, billing e-mail, payment terms, currency and notes are editable in the Furnizori tab. Payment terms fill in a missing due date (`due_from_terms`). |
| 2 | **Invoice calendar** (due dates) | **Implemented.** Scadențe tab: a month grid (an agenda list on phones), overdue/unpaid/paid shown by colour and icon, the amount to pay per currency. |
| 3 | **Tax overview** (deductible VAT by rate and period) | **Implemented.** TVA tab: per month, currency and rate, the **estimated** (calculated) VAT next to the VAT **confirmed by the accountant** (separate table `external_vat_confirmations`, audit-logged), with the difference. Periods whose invoices state no VAT show "not stated", never 0. |
| 4 | **Payment tracking** | **Implemented:** paid/unpaid/unknown, payment date, bulk mark, history. Bank reconciliation is not implemented. |
| 5 | **Recurring invoices** | **Implemented.** A supplier with invoices in at least 3 of the previous 4 months is "monthly" (usual day = median issue day). If this month's invoice hasn't arrived 7 days after the usual day, it is listed as missing. |
| 6 | **Duplicate detection** | **Implemented** (see 6.1). |
| 7 | **Anomaly detection** | **Implemented (rules).** At ingestion: a total above 1.5x the supplier's last-6 average (same currency, at least 3 invoices, at least 50 units more) sets `amount_anomaly`; a VAT id different from the registry sets `vat_id_changed`. Both send the invoice to review. Bank-detail changes are not detected (no IBAN is extracted yet). |
| 8 | **Monthly/annual reports** | **Partial:** CSV/XLSX export by any filter/period, and ZIP of originals by period. A dedicated report is proposed. |
| 9 | **AI assistant** (questions on invoices/VAT/due dates) | **Proposed.** It must answer only from stored data, cite invoices, and label every tax figure as an estimate. |

**Rule kept everywhere:** the platform's VAT/totals are **calculated estimates**. Confirmed tax obligations come from the accountant and must be stored and labelled separately; this is not implemented yet.

---

## 8. What can be automated

| Fully automatic (once configured) | Needs a person |
|---|---|
| Google Ads invoices + PDF (after Google approves invoice API access) | Anthropic, DeepSeek, Stripe originals (no invoice API) |
| E-mailed invoices to a dedicated mailbox (after section 3) | Confirming AI-extracted data ("needs review") |
| Romanian B2B invoices via RO e-Factura (after section 4.1 is verified and built) | Resolving duplicates and validation flags |
| Due/overdue reminders, duplicate flags, validation | Marking payments (until bank reconciliation exists) |
| | Accounting validation / tax filing (always the accountant) |

Portal automation (browser scripting of provider dashboards) is **not recommended**:

- MFA and CAPTCHA would have to be bypassed, which we must not do;
- it most likely conflicts with provider terms **[U]**;
- it is brittle.

Prefer e-mail delivery, official APIs or e-invoicing networks.

---

## 9. Roadmap

| Phase | Content | Depends on |
|---|---|---|
| **0, done** | Unified pipeline + adapter interface, Google Ads adapter, uploads (PDF/image/XML), AI draft extraction, validation, duplicates, corrections history, notes, attachments, payment tracking, KPIs, filters, CSV/XLSX, ZIP, reminders | — |
| **1** | Rotate `ANTHROPIC_API_KEY` and test real extraction on 10–20 real invoices (measure accuracy); request Google Ads API access for invoices | Keys / Google |
| **2, done** | Deterministic UBL/CII XML parser (`einvoice-xml.ts`: no AI, XXE-safe, unit-tested on UBL/RO_CIUS and CII samples) | — |
| **3** | RO e-Factura receiving adapter: verify the ANAF docs, OAuth with certificate, poll the message list, download, parse XML | ANAF docs, certificate |
| **4** | Invoices mailbox: job table + Gmail push (or Graph), attachment ingestion, sender→supplier mapping | Workspace/365 decision, compliance check |
| **5, done** | Supplier registry, recurring-invoice detection, anomaly rules, due-date calendar, VAT period report (estimated vs confirmed) | — |
| **6** | Peppol access point (only if suppliers outside RO e-Factura send via Peppol) | Provider choice |
| **7** | AI assistant over stored invoices (read-only, cites invoices) | — |
