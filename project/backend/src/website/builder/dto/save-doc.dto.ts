import { IsObject } from 'class-validator';

/**
 * Whole-doc save from the studio. The body is an arbitrary `BuilderDoc`-shaped
 * object — `normalizeDoc` + `coerceContent` + `assertDocClean` fully sanitise it
 * server-side (same trust boundary the AI-plan / legacy-migration paths use), so
 * no field-level validation is needed here.
 */
export class SaveDocDto {
  @IsObject()
  doc!: Record<string, unknown>;
}
