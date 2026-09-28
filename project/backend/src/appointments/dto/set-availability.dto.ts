import { Type } from 'class-transformer';
import { ArrayMaxSize, IsInt, Max, Min, ValidateNested } from 'class-validator';

export class AvailabilityWindowDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsInt()
  @Min(0)
  @Max(24 * 60)
  startMinute!: number;

  @IsInt()
  @Min(0)
  @Max(24 * 60)
  endMinute!: number;
}

/** Replaces the whole weekly template in one call — simpler and less error-prone
 *  for the owner's schedule editor than diffing individual add/remove calls. */
export class SetAvailabilityDto {
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  @ArrayMaxSize(50)
  windows!: AvailabilityWindowDto[];
}
