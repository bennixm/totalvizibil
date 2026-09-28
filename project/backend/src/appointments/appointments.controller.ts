import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { AppointmentsService } from './appointments.service';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { SetAvailabilityDto } from './dto/set-availability.dto';
import { SetAppointmentSettingsDto } from './dto/set-appointment-settings.dto';

@UseGuards(AuthGuard)
@Controller('companies/:companyId/appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get('settings')
  getSettings(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.appointments.getSettings(user.id, companyId);
  }

  @Put('settings')
  setSettings(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SetAppointmentSettingsDto,
  ) {
    return this.appointments.setSettings(user.id, companyId, dto);
  }

  @Put('availability')
  setAvailability(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SetAvailabilityDto,
  ) {
    return this.appointments.setAvailability(user.id, companyId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('status') status?: string,
    @Query('upcomingOnly') upcomingOnly?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.appointments.list(user.id, companyId, {
      status,
      upcomingOnly: upcomingOnly === 'true',
      from,
      to,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('summary')
  summary(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.appointments.summary(user.id, companyId);
  }

  @Patch(':appointmentId')
  updateStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.appointments.updateStatus(user.id, companyId, appointmentId, dto.status);
  }

  @Delete(':appointmentId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
  ) {
    return this.appointments.remove(user.id, companyId, appointmentId);
  }
}
