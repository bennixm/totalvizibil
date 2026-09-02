import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class DraftSeedDto {
  @IsString()
  @MaxLength(120)
  businessName!: string;
}

export class CreateDraftDto {
  @IsOptional()
  @IsIn(['easy', 'advanced'])
  mode?: 'easy' | 'advanced';

  /** Optional pre-fill so a starter website exists immediately (advanced info gate). */
  @IsOptional()
  @ValidateNested()
  @Type(() => DraftSeedDto)
  seed?: DraftSeedDto;

  /** UI language — drives the composed section titles and the AI Services copy. */
  @IsOptional()
  @IsIn(['ro', 'en', 'de'])
  locale?: 'ro' | 'en' | 'de';
}
