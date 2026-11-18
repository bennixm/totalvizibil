import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  STATUS_GROUPS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_SORTS,
  TICKET_STATUSES,
  type StatusGroup,
  type SupportPerspective,
  type TicketCategory,
  type TicketPriority,
  type TicketSort,
  type TicketStatus,
} from '../support.constants';

export class ListTicketsQuery {
  /** `requester` = the customer view (own tickets only), even for staff. See
   *  `SupportPerspective`. Omitted = whatever the caller's roles allow. */
  @IsOptional()
  @IsIn(['staff', 'requester'])
  as?: SupportPerspective;

  /** Staff only — `all` shows the whole queue, `mine` just their own tickets. */
  @IsOptional()
  @IsIn(['mine', 'all'])
  scope?: 'mine' | 'all';

  /** A specific status. Wins over `statusGroup` when both are sent. */
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: TicketStatus;

  /** `active` = open/in progress/waiting, `done` = resolved/closed. */
  @IsOptional()
  @IsIn(Object.keys(STATUS_GROUPS))
  statusGroup?: StatusGroup;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;

  @IsOptional()
  @IsIn(TICKET_CATEGORIES)
  category?: TicketCategory;

  /** Staff only. */
  @IsOptional()
  @IsIn(['me', 'unassigned'])
  assignee?: 'me' | 'unassigned';

  /** Default `activity` (most recently active first). */
  @IsOptional()
  @IsIn(TICKET_SORTS)
  sort?: TicketSort;

  /** Subject or `#number` for everyone; staff also match the requester's
   *  name/email and the business name. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  /** Opaque "give me the next page" token — the id of the last item of the
   *  previous page, exactly as returned in that page's `nextCursor`. Same
   *  contract as the notifications list. */
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

/** Just the perspective, for the endpoints that take nothing else. */
export class PerspectiveQuery {
  @IsOptional()
  @IsIn(['staff', 'requester'])
  as?: SupportPerspective;
}
