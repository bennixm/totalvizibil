import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { isSupportStaff } from './support.constants';
import { SupportActor, SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQuery } from './dto/list-tickets.query';
import { PostMessageDto } from './dto/post-message.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';

@UseGuards(AuthGuard)
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  private actor(user: AuthPrincipal): SupportActor {
    return { id: user.id, staff: isSupportStaff(user.platformRoles) };
  }

  private assertStaff(user: AuthPrincipal): SupportActor {
    const actor = this.actor(user);
    if (!actor.staff) throw new ForbiddenException('Support staff access required');
    return actor;
  }

  @Get('tickets')
  list(@CurrentUser() user: AuthPrincipal, @Query() query: ListTicketsQuery) {
    return this.support.list(this.actor(user), query);
  }

  /** Staff queue counters. */
  @Get('overview')
  overview(@CurrentUser() user: AuthPrincipal) {
    this.assertStaff(user);
    return this.support.overview();
  }

  /** Staff members a ticket can be assigned to. */
  @Get('staff')
  staff(@CurrentUser() user: AuthPrincipal) {
    this.assertStaff(user);
    return this.support.assignableStaff();
  }

  /** Tighter than the global rate limit: a real person opens a handful of
   *  tickets a day, and each one fans a notification out to the whole
   *  support queue — so this is the one route where a loop is both cheap to
   *  run and expensive to receive. */
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  @Post('tickets')
  create(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateTicketDto) {
    return this.support.create(this.actor(user), dto);
  }

  @Get('tickets/:id')
  get(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.get(this.actor(user), id);
  }

  @Post('tickets/:id/messages')
  postMessage(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostMessageDto,
  ) {
    return this.support.postMessage(this.actor(user), id, dto);
  }

  /** Upload one file (PDF/image), returned id is attached to the message
   *  that references it in the following `postMessage` call. Throttled
   *  separately from the message-post rate — a handful of up-to-6MB
   *  uploads per minute is plenty for a real person attaching evidence. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('tickets/:id/attachments')
  uploadAttachment(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadAttachmentDto,
  ) {
    return this.support.uploadAttachment(this.actor(user), id, dto);
  }

  @Get('tickets/:id/attachments/:attachmentId')
  async downloadAttachment(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const att = await this.support.getAttachment(this.actor(user), id, attachmentId);
    res.setHeader('Content-Type', att.mime);
    res.setHeader('Content-Length', att.size);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${att.filename.replace(/"/g, "'")}"`);
    res.end(att.bytes);
  }

  @Patch('tickets/:id')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.support.update(this.actor(user), id, dto);
  }
}
