import { IsUUID } from 'class-validator';

export class AdClickDto {
  /** The listing that was clicked (feed item id). */
  @IsUUID()
  companyId!: string;
}
