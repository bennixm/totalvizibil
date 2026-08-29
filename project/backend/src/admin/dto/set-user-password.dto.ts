import { IsString, MaxLength, MinLength } from 'class-validator';

export class SetUserPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}
