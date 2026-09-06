import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AiPlanDto {
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  brief!: string;

  /**
   * `improve` (default on a follow-up prompt) evolves the current site;
   * `replace` rebuilds it from scratch. Ignored on the first prompt.
   */
  @IsOptional()
  @IsIn(['improve', 'replace'])
  mode?: 'improve' | 'replace';
}
