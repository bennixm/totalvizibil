import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ReplyLeadDto {
  /** Body of the quick reply — emailed to the visitor, verbatim. */
  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(4000)
  message!: string;
}
