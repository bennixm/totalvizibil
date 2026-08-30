import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitLeadDto {
  @IsIn(['form', 'call'])
  channel!: 'form' | 'call';

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  message?: string;
}
