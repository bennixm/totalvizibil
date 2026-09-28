import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/** Public — the appointment-booking widget on a company's generated site. */
export class SubmitAppointmentDto {
  @IsISO8601()
  startsAt!: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
