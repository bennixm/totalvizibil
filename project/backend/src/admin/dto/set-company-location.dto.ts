import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** Admin-side full service-area override — judete only, multi-select, no radius. */
export class SetCompanyLocationDto {
  /** One or several județe — required unless `nationwide` is set. */
  @ValidateIf((o: SetCompanyLocationDto) => !o.nationwide)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(42)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  counties?: string[];

  @IsOptional()
  @IsBoolean()
  nationwide?: boolean;
}
