import { IsIn } from 'class-validator';

export class SetCompanyStatusDto {
  /** 'suspended' bans the listing; 'active' lifts the ban (back to draft). */
  @IsIn(['active', 'suspended'])
  status!: 'active' | 'suspended';
}
