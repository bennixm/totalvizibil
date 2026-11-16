import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AiLocale } from '../../ai/ai.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class TranslateCategoryNameDto {
  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(60)
  text!: string;

  @IsIn(['ro', 'en', 'de'])
  from!: AiLocale;
}
