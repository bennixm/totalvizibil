import { IsString, MaxLength, MinLength } from 'class-validator';

export class AiSectionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(600)
  instruction!: string;
}
