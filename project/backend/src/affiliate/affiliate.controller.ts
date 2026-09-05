import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { AffiliateService } from './affiliate.service';
import { ClaimReferralDto } from './dto/claim-referral.dto';

/** The signed-in user's own affiliate panel. */
@UseGuards(AuthGuard)
@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliate: AffiliateService) {}

  /** Referral code + link data + this user's referral counts. Generates the code on first call. */
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal) {
    return this.affiliate.myStats(user.id);
  }

  /**
   * Attribute the current (freshly registered) user to a referral code. Called by the
   * frontend right after sign-up when a `?ref=` code was captured. Idempotent and
   * best-effort — never errors on a bad/expired/self code.
   */
  @Post('claim')
  claim(@CurrentUser() user: AuthPrincipal, @Body() dto: ClaimReferralDto) {
    return this.affiliate.claim(user.id, dto.code);
  }
}
