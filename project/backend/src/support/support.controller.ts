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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { isSupportStaff } from './support.constants';
import { SupportActor, SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQuery } from './dto/list-tickets.query';
import { PostMessageDto } from './dto/post-message.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

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

  @Patch('tickets/:id')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.support.update(this.actor(user), id, dto);
  }
}
