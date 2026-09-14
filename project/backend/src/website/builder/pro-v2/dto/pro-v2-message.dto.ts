import { IsString, MaxLength, MinLength } from 'class-validator';

export class ProV2MessageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  content!: string;
}
