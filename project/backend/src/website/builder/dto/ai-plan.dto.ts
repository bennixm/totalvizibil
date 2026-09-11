import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

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

  /**
   * Variant seed for a fresh generation — same brief + different seed ⇒ a
   * genuinely different (but still fitting) design. Absent ⇒ derived from the
   * company + brief (reproducible). Used only on a first / `replace` plan.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  seed?: number;
}
