import { IsOptional, IsString, MaxLength } from 'class-validator';

/** `serviceAccountKeyBase64` is deliberately optional on every field here —
 *  see `GoogleAdsCredentialsInput`'s doc comment: omitting it must leave the
 *  stored secret untouched. */
export class UpdateGoogleAdsCredentialsDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  loginCustomerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  campaignId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  serviceAccountKeyBase64?: string;
}
