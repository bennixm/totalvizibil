import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../../auth/auth.guard';
import { PlatformRoles, PlatformRolesGuard } from '../../auth/platform-roles.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthPrincipal } from '../../auth/auth.types';
import { ExternalInvoicesService } from './external-invoices.service';
import { ExternalInvoiceReportsService } from './external-invoice-reports.service';
import {
  CalendarQuery,
  ConfirmVatDto,
  UpdateSupplierDto,
  VatReportQuery,
} from './external-invoice-reports.dto';
import {
  BulkExternalInvoicesDto,
  DisplayQuery,
  ExportExternalInvoicesQuery,
  ExternalInvoiceFileDto,
  ExternalInvoiceNoteDto,
  ExternalInvoicesZipDto,
  ListExternalInvoicesQuery,
  SyncExternalInvoicesDto,
  UpdateExternalInvoiceDto,
  UploadExternalInvoiceDto,
} from './external-invoices.dto';

function file(
  f: { bytes: Buffer; mime: string; filename: string },
  inline: boolean,
): StreamableFile {
  return new StreamableFile(f.bytes, {
    type: f.mime,
    disposition: `${inline ? 'inline' : 'attachment'}; filename="${f.filename}"`,
    length: f.bytes.length,
  });
}

/** Supplier invoices (what providers bill US). Same access as every other
 *  finance report: `admin` + `finance`. Provider credentials and AI keys
 *  never leave the backend; the browser only sees stored invoices. */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin', 'finance')
@Controller('admin/finance/external-invoices')
export class ExternalInvoicesController {
  constructor(
    private readonly invoices: ExternalInvoicesService,
    private readonly reports: ExternalInvoiceReportsService,
  ) {}

  // --- static routes first (before `:id`) ---------------------------------

  @Get('providers')
  providers() {
    return this.invoices.providers();
  }

  @Get('summary')
  summary(@Query() q: DisplayQuery) {
    return this.invoices.summary(q.display);
  }

  // --- registry / insights / calendar / VAT report ------------------------

  @Get('suppliers')
  suppliers(@Query() q: DisplayQuery) {
    return this.reports.suppliers(q.display);
  }

  @Patch('suppliers/:supplierId')
  updateSupplier(
    @CurrentUser() user: AuthPrincipal,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.reports.updateSupplier(supplierId, dto, user);
  }

  @Delete('suppliers/:supplierId')
  removeSupplier(
    @CurrentUser() user: AuthPrincipal,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
  ) {
    return this.reports.removeSupplier(supplierId, user);
  }

  @Get('insights')
  insights(@Query() q: DisplayQuery) {
    return this.reports.insights(q.display);
  }

  @Get('calendar')
  calendar(@Query() q: CalendarQuery) {
    return this.reports.calendar(q.month, q.display);
  }

  /** Calculated VAT per month (an estimate) next to what the accountant
   *  confirmed; the two are stored and returned separately. */
  @Get('vat-report')
  vatReport(@Query() q: VatReportQuery) {
    return this.reports.vatReport(q);
  }

  @Put('vat-report/confirm')
  confirmVat(@CurrentUser() user: AuthPrincipal, @Body() dto: ConfirmVatDto) {
    return this.reports.confirmVat(dto, user);
  }

  @Delete('vat-report/confirm/:period/:currency')
  unconfirmVat(
    @CurrentUser() user: AuthPrincipal,
    @Param('period') period: string,
    @Param('currency') currency: string,
  ) {
    return this.reports.removeVatConfirmation(period, currency, user);
  }

  @Get('export')
  async export(@Query() q: ExportExternalInvoicesQuery) {
    const f = await this.invoices.exportFile(q);
    return new StreamableFile(f.buffer, {
      type: f.contentType,
      disposition: `attachment; filename="${f.filename}"`,
      length: f.buffer.length,
    });
  }

  @Get()
  list(@Query() q: ListExternalInvoicesQuery) {
    return this.invoices.list(q);
  }

  @Post('zip')
  @HttpCode(200)
  async zip(@Body() dto: ExternalInvoicesZipDto) {
    const { buffer, filename } = await this.invoices.zip(dto);
    return new StreamableFile(buffer, {
      type: 'application/zip',
      disposition: `attachment; filename="${filename}"`,
      length: buffer.length,
    });
  }

  @Post('sync')
  @HttpCode(200)
  sync(@CurrentUser() user: AuthPrincipal, @Body() dto: SyncExternalInvoicesDto) {
    return this.invoices.sync(dto, user);
  }

  /** AI draft of an uploaded document's fields. Paid per call, so capped. */
  @Post('extract')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  extract(@Body() dto: ExternalInvoiceFileDto) {
    return this.invoices.extract(dto);
  }

  @Post('bulk')
  @HttpCode(200)
  bulk(@CurrentUser() user: AuthPrincipal, @Body() dto: BulkExternalInvoicesDto) {
    return this.invoices.bulk(dto, user);
  }

  @Post()
  upload(@CurrentUser() user: AuthPrincipal, @Body() dto: UploadExternalInvoiceDto) {
    return this.invoices.upload(dto, user);
  }

  // --- one invoice --------------------------------------------------------

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.detail(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExternalInvoiceDto,
  ) {
    return this.invoices.update(id, dto, user);
  }

  /** The original document; `?inline=1` opens it instead of downloading. */
  @Get(':id/document')
  async document(@Param('id', ParseUUIDPipe) id: string, @Query('inline') inline?: string) {
    return file(await this.invoices.document(id), inline === '1');
  }

  @Post(':id/notes')
  note(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExternalInvoiceNoteDto,
  ) {
    return this.invoices.addNote(id, dto.text, user);
  }

  @Post(':id/attachments')
  addAttachment(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExternalInvoiceFileDto,
  ) {
    return this.invoices.addAttachment(id, dto, user);
  }

  @Get(':id/attachments/:attachmentId')
  async attachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Query('inline') inline?: string,
  ) {
    return file(await this.invoices.attachment(id, attachmentId), inline === '1');
  }

  @Delete(':id/attachments/:attachmentId')
  async removeAttachment(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    await this.invoices.removeAttachment(id, attachmentId, user);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    await this.invoices.remove(id, user);
    return { ok: true };
  }
}
