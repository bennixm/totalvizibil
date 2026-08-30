import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { LeadsService } from './leads.service';
import { UpdateLeadDto } from './dto/update-lead.dto';

@UseGuards(AuthGuard)
@Controller('companies/:companyId/leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.leads.list(user.id, companyId, {
      status,
      channel,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('summary')
  summary(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.leads.summary(user.id, companyId);
  }

  @Get(':leadId')
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ) {
    return this.leads.get(user.id, companyId, leadId);
  }

  @Patch(':leadId')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leads.update(user.id, companyId, leadId, dto);
  }

  @Delete(':leadId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ) {
    return this.leads.remove(user.id, companyId, leadId);
  }
}
