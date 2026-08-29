import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { SessionCookieService } from '../auth/session-cookie.service';
import { AuthUserView } from '../auth/auth.types';
import { WebsiteDraftsService } from './website-drafts.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { ClaimDraftDto } from './dto/claim-draft.dto';

/**
 * Public, pre-account "Create your business" flow (PRD §11, new UX):
 *   generate -> preview/edit -> claim (register at the end)
 */
@Controller('website-drafts')
export class WebsiteDraftsController {
  constructor(
    private readonly drafts: WebsiteDraftsService,
    private readonly cookie: SessionCookieService,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  create(@Body() dto: CreateDraftDto) {
    return this.drafts.create(dto);
  }

  @Get(':token')
  get(@Param('token') token: string) {
    return this.drafts.get(token);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Patch(':token')
  update(@Param('token') token: string, @Body() dto: UpdateDraftDto) {
    return this.drafts.updateContent(token, dto.content);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(201)
  @Post(':token/claim')
  async claim(
    @Param('token') token: string,
    @Body() dto: ClaimDraftDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUserView; company: { id: string; slug: string } }> {
    const { user, company } = await this.drafts.claim(token, dto);
    await this.cookie.start(req, res, user.id);
    return { user, company: { id: company.id, slug: company.slug } };
  }
}
