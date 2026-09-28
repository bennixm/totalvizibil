import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class SetAppointmentSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn([15, 20, 30, 45, 60, 90, 120])
  slotMinutes?: number;
}
