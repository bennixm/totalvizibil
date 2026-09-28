import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppointmentsService } from './appointments.service';
import { SubmitAppointmentDto } from './dto/submit-appointment.dto';

/** Public — the appointment-booking widget on a company's generated site. */
@Controller('public/companies/:slug/appointments')
export class PublicAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  /** `date` is a plain `YYYY-MM-DD` — always live-computed, never cached, so
   *  the widget shows the true current availability on every call. */
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('slots')
  slots(@Param('slug') slug: string, @Query('date') date: string) {
    return this.appointments.availableSlotsFor(slug, date);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(202)
  @Post()
  submit(
    @Param('slug') slug: string,
    @Body() dto: SubmitAppointmentDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.appointments.submitPublic(slug, dto, ip, userAgent);
  }
}
