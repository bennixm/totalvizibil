import { IsString, MaxLength, MinLength } from 'class-validator';

/** Starts (or restarts) pre-generation clarification for a fresh brief. */
export class AiClarifyDto {
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  brief!: string;
}
