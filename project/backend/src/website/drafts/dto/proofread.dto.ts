import { IsString, MaxLength, MinLength } from 'class-validator';

export class ProofreadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1200)
  text!: string;
}
