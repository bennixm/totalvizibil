import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** An automatic error report from the frontend's WebContainer sandbox — not
 *  free-form user input, so it gets its own (tighter, differently-shaped)
 *  validation instead of reusing `ProV2MessageDto`. */
export class ProV2RepairDto {
  @IsIn(['install', 'build', 'runtime'])
  kind!: 'install' | 'build' | 'runtime';

  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  summary!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  path?: string;

  /** The frontend's own repair-attempt counter (1-3, see `lib/repair-loop.ts`)
   *  — the router uses it to pick the tier, escalating each time the browser
   *  reports the previous fix didn't actually land. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  attempt?: number;
}
