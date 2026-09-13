import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ClarifyAnswerDto {
  @IsString()
  @MaxLength(40)
  questionId!: string;

  @IsString()
  @MaxLength(300)
  value!: string;
}

/** Answers one round of clarification questions; returns the next round or `{done:true}`. */
export class AiClarifyAnswerDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => ClarifyAnswerDto)
  answers!: ClarifyAnswerDto[];
}
