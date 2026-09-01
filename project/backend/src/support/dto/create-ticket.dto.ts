import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type TicketCategory,
  type TicketPriority,
} from '../support.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTicketDto {
  @IsString()
  @Transform(trim)
  @MinLength(4)
  @MaxLength(160)
  subject!: string;

  @IsString()
  @Transform(trim)
  @MinLength(10)
  @MaxLength(5000)
  body!: string;

  @IsIn(TICKET_CATEGORIES)
  category!: TicketCategory;

  /** Optional — the reporter's own default is `normal`. */
  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;

  /** Optional — the business the ticket is about (must be one the user belongs to). */
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
