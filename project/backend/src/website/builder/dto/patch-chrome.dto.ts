import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class NavCtaDto {
  @IsString()
  @MaxLength(40)
  label!: string;

  @IsString()
  @MaxLength(60)
  target!: string;
}

class NavPatchDto {
  @IsOptional()
  @IsIn(['show', 'hide'])
  logo?: 'show' | 'hide';

  @IsOptional()
  @IsBoolean()
  sticky?: boolean;

  @IsOptional()
  @IsIn(['text', 'pill'])
  linkStyle?: 'text' | 'pill';

  @IsOptional()
  @IsBoolean()
  showPages?: boolean;

  /** `null` clears the CTA. */
  @IsOptional()
  @ValidateNested()
  @Type(() => NavCtaDto)
  cta?: NavCtaDto | null;
}

class FooterSocialDto {
  @IsString()
  @MaxLength(24)
  label!: string;

  @IsString()
  @MaxLength(200)
  url!: string;
}

class FooterPatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tagline?: string;

  @IsOptional()
  @IsBoolean()
  showLegal?: boolean;

  @IsOptional()
  @IsBoolean()
  showContact?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => FooterSocialDto)
  socials?: FooterSocialDto[];
}

export class PatchChromeDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NavPatchDto)
  nav?: NavPatchDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FooterPatchDto)
  footer?: FooterPatchDto;
}
