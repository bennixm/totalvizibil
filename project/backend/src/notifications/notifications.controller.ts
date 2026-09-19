import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

/** The bell/panel — every row here was sent with `channels.panel`. */
@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.notifications.list(user.id, { limit: limit ? Number(limit) : undefined, cursor });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthPrincipal) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Post(':id/read')
  async markRead(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(user.id, id);
    return { ok: true };
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: AuthPrincipal) {
    await this.notifications.markAllRead(user.id);
    return { ok: true };
  }
}
