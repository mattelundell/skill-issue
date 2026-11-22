import { z } from 'zod';
import { ItemIdSchema } from './content.js';

/**
 * A notebook per subject: a section for every area and every lesson, which the
 * learner writes in Markdown. The headings are the subject's own — an area's
 * title, a lesson's title — so a section is stored against the area or lesson
 * it belongs to and nothing else: a lesson moved between areas takes its
 * section with it, and one on a lesson the subject no longer holds is kept.
 */

/** The longest section kept, in characters: a lesson's worth of notes and more, short of anything that would slow a search. */
export const NOTE_MAX_LENGTH = 100_000;

/** What a section belongs to: an area of the subject, or a lesson. */
export const SectionKindSchema = z.enum(['area', 'lesson']);
export type SectionKind = z.infer<typeof SectionKindSchema>;

/** One written section of a notebook. A section with nothing written is not stored and not listed. */
export const NotebookSectionSchema = z.object({
  subjectId: ItemIdSchema,
  kind: SectionKindSchema,
  /** The area's or the lesson's id. */
  itemId: ItemIdSchema,
  /** Markdown, as written. An image the learner added is referenced as `bilder/<name>`. */
  body: z.string().min(1).max(NOTE_MAX_LENGTH),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type NotebookSection = z.infer<typeof NotebookSectionSchema>;

/** A subject's written sections, the most recently written first. The browser lays them over the subject's areas and lessons. */
export const NotebookSchema = z.object({
  subjectId: ItemIdSchema,
  sections: z.array(NotebookSectionSchema),
});
export type Notebook = z.infer<typeof NotebookSchema>;

/** What the browser sends to write a section. A body of nothing but white space removes it. */
export const SaveSectionSchema = z.strictObject({
  body: z.string().max(NOTE_MAX_LENGTH),
});
export type SaveSection = z.infer<typeof SaveSectionSchema>;

/** One subject's notebook in the list across subjects. */
export const NotebookSummarySchema = z.object({
  subjectId: ItemIdSchema,
  /** How many sections hold something. */
  written: z.number().int().min(0),
  /** The ids of the areas with something written in the area's own section or one of its lessons', as the subject now stands. */
  areasWritten: z.array(ItemIdSchema),
  /** The section written last, if any. */
  last: z.object({ kind: SectionKindSchema, itemId: ItemIdSchema, updatedAt: z.iso.datetime({ offset: true }) }).optional(),
});
export type NotebookSummary = z.infer<typeof NotebookSummarySchema>;

export const NotebookSummaryListSchema = z.object({ notebooks: z.array(NotebookSummarySchema) });
export type NotebookSummaryList = z.infer<typeof NotebookSummaryListSchema>;

/**
 * The kinds of image a notebook keeps, by the extension its name takes. No SVG:
 * it can carry script, and a pasted screenshot is never one.
 */
export const NOTE_IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as const;
export const NoteImageTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** The largest image kept, in bytes: a full-screen screenshot fits, a photo library does not. */
export const NOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** An image's name in its notebook, as a note references it after `bilder/`. */
export const NoteImageNameSchema = z.string().regex(/^bild-[1-9][0-9]{0,5}\.(png|jpg|gif|webp)$/);

/** An image the learner adds to a note: its type, and its bytes in base64, since every write is JSON. */
export const AddNoteImageSchema = z.strictObject({
  mediaType: NoteImageTypeSchema,
  /** The size is the server's to judge once decoded, so an image too large is told so (413) rather than called malformed. */
  data: z.base64(),
});
export type AddNoteImage = z.infer<typeof AddNoteImageSchema>;

/** The image as kept: the name to reference it by, as `![…](bilder/<name>)`. */
export const NoteImageSchema = z.object({ name: NoteImageNameSchema, mediaType: NoteImageTypeSchema });
export type NoteImage = z.infer<typeof NoteImageSchema>;

/**
 * A note's text with each of its own headings moved `levels` down — at most
 * to 6, the deepest Markdown has — so a heading the learner wrote does not read
 * as one of the notebook's areas or lessons, in the browser and in an export alike. Lines in a fenced code block are
 * left as written.
 */
export function headingsBelow(body: string, levels: number): string {
  let fence: string | undefined;
  return body
    .split('\n')
    .map((line) => {
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (opening !== null) {
        const marker = opening[1] ?? '';
        if (fence === undefined) {
          fence = marker;
        } else if (marker.startsWith(fence[0] ?? '') && marker.length >= fence.length) {
          fence = undefined;
        }
        return line;
      }
      if (fence !== undefined) {
        return line;
      }
      const heading = /^( {0,3})(#{1,6})([ \t].*|)$/.exec(line);
      if (heading === null) {
        return line;
      }
      const [, indent = '', hashes = '', rest = ''] = heading;
      return `${indent}${'#'.repeat(Math.min(6, hashes.length + levels))}${rest}`;
    })
    .join('\n');
}
