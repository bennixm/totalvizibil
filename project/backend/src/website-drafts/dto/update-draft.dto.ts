import { IsObject } from 'class-validator';
import { WebsiteContent } from '../../website/website.types';

/** Inline edits from the preview screen. `content` is the full block tree. */
export class UpdateDraftDto {
  @IsObject()
  content!: WebsiteContent;
}
