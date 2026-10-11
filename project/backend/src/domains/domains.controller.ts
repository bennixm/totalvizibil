import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { DomainsService } from './domains.service';
import { PurchaseDomainDto } from './dto/purchase-domain.dto';

@UseGuards(AuthGuard)
@Controller('companies/:id/domains')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  list(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.listForCompany(user.id, id);
  }

  @Get('check')
  check(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('domain') domain: string,
  ) {
    return this.domains.checkAvailability(user.id, id, domain ?? '');
  }

  @Post()
  purchase(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseDomainDto,
  ) {
    return this.domains.purchase(user.id, id, dto.domain);
  }
}
