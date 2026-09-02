import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class RegenerateServicesDto {
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  names!: string[];
}
