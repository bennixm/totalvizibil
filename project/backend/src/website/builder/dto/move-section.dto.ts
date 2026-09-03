import { IsInt, IsString, Min } from 'class-validator';

export class MoveSectionDto {
  @IsString()
  toPageId!: string;

  @IsInt()
  @Min(0)
  toIndex!: number;
}
