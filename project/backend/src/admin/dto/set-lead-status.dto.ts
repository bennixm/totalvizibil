import { IsIn } from 'class-validator';

export class SetLeadStatusDto {
  @IsIn(['new', 'seen', 'resolved'])
  status!: 'new' | 'seen' | 'resolved';
}
