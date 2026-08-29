import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateDraftDto {
  @IsIn(['easy', 'advanced'])
  mode!: 'easy' | 'advanced';

  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(160)
  businessName!: string;

  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(120)
  businessType!: string;

  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(120)
  city!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  services!: string[];

  @IsString()
  @Transform(trim)
  @MinLength(10)
  @MaxLength(600)
  shortDescription!: string;

  // --- advanced-only ---
  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetAudience?: string;

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsIn(['professional', 'friendly', 'premium', 'bold', 'calm'])
  toneOfVoice?: 'professional' | 'friendly' | 'premium' | 'bold' | 'calm';

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsIn(['indigo', 'emerald', 'amber', 'slate', 'rose'])
  palette?: 'indigo' | 'emerald' | 'amber' | 'slate' | 'rose';

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsIn(['grotesk-inter', 'serif-sans', 'mono-sans'])
  fontPair?: 'grotesk-inter' | 'serif-sans' | 'mono-sans';

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsIn(['sharp', 'soft', 'round'])
  radius?: 'sharp' | 'soft' | 'round';

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsString()
  @MaxLength(60)
  primaryCta?: string;

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsBoolean()
  includeFaq?: boolean;

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsBoolean()
  includeTestimonials?: boolean;

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  seoKeywords?: string[];

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ValidateIf((o) => o.mode === 'advanced')
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
