import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthPrincipal } from '../../auth/auth.types';
import { WebsiteBuilderService } from './website-builder.service';
import { SendMessageDto } from '../drafts/dto/send-message.dto';

@UseGuards(AuthGuard)
@Controller('companies/:companyId/website-builder')
export class WebsiteBuilderController {
  constructor(private readonly builder: WebsiteBuilderService) {}

  @Get()
  get(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.builder.get(user.id, companyId);
  }

  /** Pay the one-time advanced-builder unlock fee from the wallet. */
  @Post('unlock')
  unlock(@CurrentUser() user: AuthPrincipal, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.builder.unlock(user.id, companyId);
  }

  @Post('messages')
  send(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.builder.sendMessage(user.id, companyId, dto.text);
  }
}
