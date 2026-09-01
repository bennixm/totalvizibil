import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../support.constants';

export class UpdateTicketDto {
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: TicketStatus;

  /** Staff only. */
  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;

  /** Staff only. */
  @IsOptional()
  @IsIn(TICKET_CATEGORIES)
  category?: TicketCategory;

  /**
   * Staff only. `"me"` self-assigns, a user id assigns that staff member, an
   * empty string unassigns.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assigneeId?: string;
}
