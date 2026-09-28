import { IsIn } from 'class-validator';

export class UpdateAppointmentDto {
  @IsIn(['confirmed', 'canceled', 'completed'])
  status!: 'confirmed' | 'canceled' | 'completed';
}
