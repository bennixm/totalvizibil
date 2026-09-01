import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { WalletService } from './wallet.service';
import { BuyCreditsDto } from './dto/buy-credits.dto';
import { SetWalletCurrencyDto } from './dto/set-currency.dto';

/** The user's single wallet — it funds every business they own. */
@UseGuards(AuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  get(@CurrentUser() user: AuthPrincipal) {
    return this.wallet.getSummary(user.id);
  }

  /** Cheap FX context (display currency + EUR->RON rate) for any page showing credits. */
  @Get('fx')
  fx(@CurrentUser() user: AuthPrincipal) {
    return this.wallet.fx(user.id);
  }

  /** Switch the wallet's display currency (EUR or RON). */
  @Patch('currency')
  setCurrency(@CurrentUser() user: AuthPrincipal, @Body() dto: SetWalletCurrencyDto) {
    return this.wallet.setCurrency(user.id, dto.currency);
  }

  @Get('transactions')
  transactions(
    @CurrentUser() user: AuthPrincipal,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.wallet.listTransactions(user.id, {
      limit: limit ? Number(limit) : undefined,
      cursor,
      companyId,
    });
  }

  /** Start a credit purchase — returns a pending transaction + EUR/RON amounts. */
  @Post('purchases')
  buy(@CurrentUser() user: AuthPrincipal, @Body() dto: BuyCreditsDto) {
    return this.wallet.startPurchase(user.id, dto.credits);
  }

  /** Confirm a pending purchase (dev/stub stands in for the provider webhook). */
  @Post('purchases/:txnId/confirm')
  confirm(@CurrentUser() user: AuthPrincipal, @Param('txnId', ParseUUIDPipe) txnId: string) {
    return this.wallet.confirmPurchase(user.id, txnId);
  }
}
