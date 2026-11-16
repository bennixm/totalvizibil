import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A short, honest trace of what the visitor just did via a widget (the
 * "Continuă"/"Sari" buttons, a photo upload) — logged as a real `user`-role
 * transcript turn so the conversation doesn't go silent on their side. Never
 * an i18n key: always already-resolved text (see `advanceEasy`'s own
 * comment on this).
 */
export class AdvanceStepDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
