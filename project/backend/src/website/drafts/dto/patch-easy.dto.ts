import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class EasyServiceDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsString()
  @MaxLength(300)
  description!: string;
}

export class EasyTestimonialDto {
  @IsString()
  @MaxLength(400)
  quote!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  author?: string;
}

export class EasyFaqDto {
  @IsString()
  @MaxLength(160)
  q!: string;

  @IsString()
  @MaxLength(600)
  a!: string;
}

export class EasyStatDto {
  @IsString()
  @MaxLength(24)
  value!: string;

  @IsString()
  @MaxLength(60)
  label!: string;
}

export class EasyProcessDto {
  @IsString()
  @MaxLength(80)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  text?: string;
}

/** Live config edits from the studio widgets — no chat turn is spent. */
export class PatchEasyDto {
  @IsOptional()
  @IsString()
  @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: 'accentColor must be #rrggbb' })
  accentColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  landingTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  landingSubtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  landingImage?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  portfolio?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => EasyServiceDto)
  services?: EasyServiceDto[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  // --- extra sections ------------------------------------------------
  @IsOptional()
  @IsString()
  @MaxLength(900)
  about?: string;

  @IsOptional()
  @IsBoolean()
  showAbout?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => EasyStatDto)
  stats?: EasyStatDto[];

  @IsOptional()
  @IsBoolean()
  showStats?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(90, { each: true })
  whyUs?: string[];

  @IsOptional()
  @IsBoolean()
  showWhyUs?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => EasyProcessDto)
  process?: EasyProcessDto[];

  @IsOptional()
  @IsBoolean()
  showProcess?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => EasyTestimonialDto)
  testimonials?: EasyTestimonialDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => EasyFaqDto)
  faq?: EasyFaqDto[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ctaHeadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  ctaButton?: string;

  @IsOptional()
  @IsBoolean()
  showCta?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  hours?: string;

  @IsOptional()
  @IsIn(['classic', 'bold', 'minimal'])
  template?: 'classic' | 'bold' | 'minimal';

  @IsOptional()
  @IsBoolean()
  autoGrammar?: boolean;

  @IsOptional()
  @IsIn(['ro', 'en', 'de'])
  locale?: 'ro' | 'en' | 'de';
}
