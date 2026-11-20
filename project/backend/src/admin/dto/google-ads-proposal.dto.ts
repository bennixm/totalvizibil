import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ApproveGoogleAdsProposalDto {
  /** Hash of the proposal content the admin saw (from the proposals list). */
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{16}$/)
  contentHash?: string;
}

export class ReviseGoogleAdsProposalDto {
  /** What the agent should do differently. Never authorizes execution. */
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  instructions!: string;
}
