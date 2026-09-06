import { IsBoolean } from 'class-validator';

export class SetWebsitePublishedDto {
  @IsBoolean()
  published!: boolean;
}
