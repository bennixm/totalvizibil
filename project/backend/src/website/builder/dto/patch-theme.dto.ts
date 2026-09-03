import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

const PALETTES = [
  'indigo',
  'violet',
  'blue',
  'cyan',
  'teal',
  'emerald',
  'lime',
  'amber',
  'orange',
  'rose',
  'fuchsia',
  'slate',
] as const;
const RADII = ['none', 'subtle', 'rounded', 'large', 'pill', 'sharp', 'soft', 'round'] as const;
const FONTS = ['grotesk', 'inter', 'fraunces', 'jetbrains'] as const;
const PRESETS = ['studio', 'bold', 'editorial', 'soft', 'tech', 'warm', 'mono'] as const;

export class PatchThemeDto {
  @IsOptional()
  @IsIn(PALETTES)
  palette?: (typeof PALETTES)[number];

  @IsOptional()
  @IsString()
  @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: 'accent must be #rrggbb' })
  accent?: string;

  @IsOptional()
  @IsIn(['grotesk-inter', 'serif-sans', 'mono-sans'])
  fontPair?: 'grotesk-inter' | 'serif-sans' | 'mono-sans';

  @IsOptional()
  @IsIn(RADII)
  radius?: (typeof RADII)[number];

  @IsOptional()
  @IsIn(['compact', 'comfortable', 'spacious'])
  density?: 'compact' | 'comfortable' | 'spacious';

  @IsOptional()
  @IsIn(PRESETS)
  preset?: (typeof PRESETS)[number];

  @IsOptional()
  @IsIn(['light', 'tinted', 'dark'])
  background?: 'light' | 'tinted' | 'dark';

  @IsOptional()
  @IsIn(FONTS)
  headingFont?: (typeof FONTS)[number];

  @IsOptional()
  @IsIn(FONTS)
  bodyFont?: (typeof FONTS)[number];

  @IsOptional()
  @IsIn(['solid', 'outline', 'soft', 'pill'])
  buttonStyle?: 'solid' | 'outline' | 'soft' | 'pill';

  @IsOptional()
  @IsIn(['none', 'soft', 'bold'])
  shadow?: 'none' | 'soft' | 'bold';
}
