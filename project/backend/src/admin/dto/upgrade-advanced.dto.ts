import { IsBoolean, IsOptional } from 'class-validator';

export class UpgradeAdvancedDto {
  /**
   * `true` → charge the owner's wallet the standard advanced-builder fee
   * (rejected if they can't afford it). `false` / omitted → grant it for free.
   */
  @IsOptional()
  @IsBoolean()
  charge?: boolean;
}
