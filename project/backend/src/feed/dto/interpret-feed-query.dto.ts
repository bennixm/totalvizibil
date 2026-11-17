import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class InterpretFeedQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  text!: string;

  @IsOptional()
  @IsIn(['ro', 'en', 'de'])
  locale?: 'ro' | 'en' | 'de';
}
