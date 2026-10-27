import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
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
   * empty string unassigns. Anything else is rejected here rather than
   * reaching Postgres as a malformed uuid (which answers a plainly bad
   * request with a 500); the service re-checks the same shape, since it is
   * also callable without this pipe.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^$|^me$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'assigneeId must be "me", a user id, or an empty string',
  })
  assigneeId?: string;
}
