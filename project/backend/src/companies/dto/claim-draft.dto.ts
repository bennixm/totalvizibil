import { IsString, MaxLength, MinLength } from 'class-validator';

export class ClaimDraftDto {
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  draftToken!: string;
}
