import { IsString, MaxLength, MinLength } from 'class-validator';

export class BroadcastMaintenanceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}
