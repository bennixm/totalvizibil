import { Body, Controller, Headers, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LeadsService } from './leads.service';
import { SubmitLeadDto } from './dto/submit-lead.dto';

/** Public — the contact form / "call" button on a company's generated site. */
@Controller('public/companies/:slug/lead')
export class PublicLeadController {
  constructor(private readonly leads: LeadsService) {}

  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  @HttpCode(202)
  @Post()
  submit(
    @Param('slug') slug: string,
    @Body() dto: SubmitLeadDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.leads.submitPublic(slug, dto.channel, dto, ip, userAgent);
  }
}
