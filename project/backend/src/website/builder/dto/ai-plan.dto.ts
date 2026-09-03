import { IsString, MaxLength, MinLength } from 'class-validator';

export class AiPlanDto {
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  brief!: string;
}
