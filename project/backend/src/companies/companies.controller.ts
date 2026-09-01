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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { CompaniesService } from './companies.service';
import { ClaimDraftDto } from './dto/claim-draft.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { SetCompanyLocationDto } from './dto/set-company-location.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@UseGuards(AuthGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post()
  create(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateCompanyDto) {
    return this.companies.create(user.id, dto);
  }

  /** End of the "create your business" flow: claim an anonymous website draft. */
  @Post('from-draft')
  createFromDraft(@CurrentUser() user: AuthPrincipal, @Body() dto: ClaimDraftDto) {
    return this.companies.createFromDraft(user.id, dto.draftToken);
  }

  @Get()
  async list(@CurrentUser() user: AuthPrincipal) {
    return { data: await this.companies.listForUser(user.id) };
  }

  /** Compact list for the dashboard company switcher. */
  @Get('overview')
  async overview(@CurrentUser() user: AuthPrincipal) {
    return { data: await this.companies.overview(user.id) };
  }

  @Get(':id')
  get(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.getForUser(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companies.update(user.id, id, dto);
  }

  /**
   * Schedule a business for deletion (owner only). The listing comes down now;
   * the record is wiped after a 7-day grace window unless the owner cancels.
   */
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.requestDeletion(user.id, id);
  }

  /** Call off a pending deletion (owner only, inside the grace window). */
  @Delete(':id/deletion')
  @HttpCode(204)
  cancelDeletion(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.cancelDeletion(user.id, id);
  }

  @Get(':id/dashboard')
  dashboard(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.dashboard(user.id, id);
  }

  /** Set / replace the company's primary service-area location (post-account). */
  @Patch(':id/location')
  setLocation(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCompanyLocationDto,
  ) {
    return this.companies.setLocation(user.id, id, dto);
  }

  @Post(':id/publish')
  publish(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.setPublished(user.id, id, true);
  }

  @Post(':id/unpublish')
  unpublish(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.setPublished(user.id, id, false);
  }
}
