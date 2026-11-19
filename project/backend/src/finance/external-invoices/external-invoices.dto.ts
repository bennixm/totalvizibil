import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EXTERNAL_INVOICE_PROVIDER_KEYS } from './external-invoice-providers';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const SORT_FIELDS = [
  'issueDate',
  'dueDate',
  'totalMinor',
  'provider',
  'invoiceNumber',
] as const;
export const SORTS = SORT_FIELDS.flatMap((f) => [`${f}:asc`, `${f}:desc`]);

/** Filters shared by the list, the export and the ZIP-by-filter. */
export class ExternalInvoiceFilterQuery {
  @IsOptional()
  @IsIn(EXTERNAL_INVOICE_PROVIDER_KEYS)
  provider?: string;

  /** Issue-date range, both inclusive (YYYY-MM-DD). */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Invoice number, supplier, VAT id, note or the provider's own id. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(['paid', 'unpaid', 'unknown'])
  payment?: 'paid' | 'unpaid' | 'unknown';

  @IsOptional()
  @IsIn(['needs_review', 'verified'])
  processing?: 'needs_review' | 'verified';

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  /** Unpaid and past due, or unpaid and due within 7 days. */
  @IsOptional()
  @IsIn(['overdue', 'due_soon'])
  due?: 'overdue' | 'due_soon';

  @IsOptional()
  @IsIn(['api', 'manual', 'email', 'efactura', 'peppol'])
  source?: 'api' | 'manual' | 'email' | 'efactura' | 'peppol';

  @IsOptional()
  @IsIn(['yes', 'no'])
  hasDocument?: 'yes' | 'no';

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  /** Platform display currency the amounts and totals are converted to
   *  (BNR rate of each invoice's issue date). */
  @IsOptional()
  @IsIn(['EUR', 'RON'])
  display?: 'EUR' | 'RON';
}

export class DisplayQuery {
  @IsOptional()
  @IsIn(['EUR', 'RON'])
  display?: 'EUR' | 'RON';
}

export class ListExternalInvoicesQuery extends ExternalInvoiceFilterQuery {
  @IsOptional()
  @IsIn(SORTS)
  sort?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ExportExternalInvoicesQuery extends ExternalInvoiceFilterQuery {
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: 'csv' | 'xlsx';

  @IsOptional()
  @IsIn(SORTS)
  sort?: string;
}

/** What goes into a ZIP: explicit ids, or everything matching the filters
 *  (`all` = no filter at all). */
export class ExternalInvoicesZipDto extends ExternalInvoiceFilterQuery {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

export class SyncExternalInvoicesDto {
  @IsIn(['google_ads'])
  provider!: 'google_ads';

  /** How many issue months back to ask the provider for (default 3, or 24
   *  on the very first import). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(96)
  months?: number;
}

export class VatLineDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rate!: number | null;

  @IsInt()
  netMinor!: number;

  @IsInt()
  vatMinor!: number;
}

export class InvoiceLineDto {
  @IsString()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsNumber()
  quantity!: number | null;

  @IsOptional()
  @IsInt()
  unitPriceMinor!: number | null;

  @IsOptional()
  @IsInt()
  netMinor!: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  vatRate!: number | null;
}

/** Extraction metadata echoed back by the upload form when the fields were
 *  pre-filled by AI (kept on the invoice for the audit trail). */
export class ExtractionMetaDto {
  @IsString()
  @MaxLength(40)
  engine!: string;

  @IsString()
  @MaxLength(80)
  model!: string;

  @IsNumber()
  confidence!: number;

  @IsOptional()
  fieldConfidence?: Record<string, number>;

  @IsOptional()
  @IsNumber()
  estimatedCostUsd?: number;
}

/** An ORIGINAL document (from a provider without an invoice API, or a
 *  provider's PDF downloaded by hand). */
export class UploadExternalInvoiceDto {
  @IsIn(EXTERNAL_INVOICE_PROVIDER_KEYS)
  provider!: string;

  /** Required for `other` (hosting company, e-mail provider, registrar, …). */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  providerName?: string;

  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(80)
  invoiceNumber!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(40)
  supplierVatId?: string;

  @IsISO8601()
  issueDate!: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsISO8601()
  periodStart?: string;

  @IsOptional()
  @IsISO8601()
  periodEnd?: string;

  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  subtotalMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  taxMinor?: number;

  /** Minor units (cents) of `currency`, as printed on the document. */
  @IsInt()
  @Min(0)
  totalMinor!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VatLineDto)
  vatLines?: VatLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines?: InvoiceLineDto[];

  @IsOptional()
  @IsIn(['paid', 'unpaid'])
  paymentStatus?: 'paid' | 'unpaid';

  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(300)
  note?: string;

  /** The person confirmed the fields against the document. Without it an
   *  AI-prefilled upload stays "needs review". */
  @IsOptional()
  @IsBoolean()
  reviewed?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExtractionMetaDto)
  extraction?: ExtractionMetaDto;

  /** `data:<mime>;base64,…` — re-checked by magic bytes server-side. */
  @IsString()
  @MinLength(32)
  @MaxLength(8_200_000)
  dataUri!: string;

  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(150)
  filename!: string;
}

/** Manual correction: every field optional, `null` clears a nullable one. */
export class UpdateExternalInvoiceDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  providerName?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(80)
  invoiceNumber?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  supplierVatId?: string | null;

  @IsOptional()
  @IsISO8601()
  issueDate?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  dueDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  periodStart?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  periodEnd?: string | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  subtotalMinor?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  taxMinor?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalMinor?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VatLineDto)
  vatLines?: VatLineDto[] | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines?: InvoiceLineDto[] | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['paid', 'unpaid'])
  paymentStatus?: 'paid' | 'unpaid' | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  paidAt?: string | null;

  @IsOptional()
  @IsIn(['needs_review', 'verified'])
  processingStatus?: 'needs_review' | 'verified';

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class BulkExternalInvoicesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids!: string[];

  @IsIn(['mark_paid', 'mark_unpaid', 'mark_verified', 'mark_needs_review'])
  action!: 'mark_paid' | 'mark_unpaid' | 'mark_verified' | 'mark_needs_review';

  /** For `mark_paid`; defaults to today. */
  @IsOptional()
  @IsISO8601()
  paidAt?: string;
}

export class ExternalInvoiceNoteDto {
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}

export class ExternalInvoiceFileDto {
  @IsString()
  @MinLength(32)
  @MaxLength(8_200_000)
  dataUri!: string;

  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(150)
  filename!: string;
}
