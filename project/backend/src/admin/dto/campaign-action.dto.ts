import { IsIn } from 'class-validator';

export class CampaignActionDto {
  @IsIn(['pause', 'activate', 'delete'])
  action!: 'pause' | 'activate' | 'delete';
}
