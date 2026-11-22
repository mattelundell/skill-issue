import { z } from 'zod';

/**
 * The subject pack as the API carries it: every item of a subject as JSON,
 * each tagged with the language it is written in. The file form of a pack —
 * folders of YAML and Markdown — is converted to and from this shape, so this
 * is the one definition of what a subject may contain.
 */

export const FORMAT_VERSION = 1;

/** Lowercase letters and digits in hyphen-separated words. Permanent once published. */
export const ItemIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters and digits, words separated by single hyphens');

/** A language as a two- or three-letter code, optionally with a region: `sv`, `en`, `en-GB`. */
export const LanguageSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, 'a language code such as sv, en or en-GB');

const Text = z.string().trim().min(1);
/** Markdown. Raw HTML is refused by the pack rules, not by this schema. */
const Markdown = z.string().trim().min(1);
const References = z.array(ItemIdSchema);

export const ExamBlueprintSchema = z.strictObject({
  /** How many questions one sitting draws. */
  questions: z.int().min(1),
  /** The share of the drawn questions that must be right to pass. */
  passMark: z.number().gt(0).max(1),
});

/** One thing a subject teaches: its identifier, and the name a learner reads. */
export const ConceptSchema = z.strictObject({ id: ItemIdSchema, name: Text });
export type Concept = z.infer<typeof ConceptSchema>;

/**
 * What a subject is for, where it is not simply a subject to study. An
 * `introduction` teaches the application itself: once every one of its lessons
 * has been finished it leaves the start screen, and its questions are never in
 * a review across subjects.
 */
export const SubjectRoleSchema = z.enum(['introduction']);
export type SubjectRole = z.infer<typeof SubjectRoleSchema>;

export const SubjectSchema = z.strictObject({
  language: LanguageSchema,
  id: ItemIdSchema,
  defaultLanguage: LanguageSchema,
  title: Text,
  summary: Text,
  /** The areas in the order the path recommends them. */
  areas: References.min(1),
  /**
   * What the subject's lessons teach, each with the name a learner reads.
   * Lessons and questions name concepts by id; a translation names the same
   * concepts, in the same order, in its own language.
   */
  concepts: z.array(ConceptSchema).min(1),
  /** Absent for an ordinary subject; a translation states the same as the default language. */
  role: SubjectRoleSchema.optional(),
});

export const SourceKindSchema = z.enum(['summary', 'excerpt', 'full']);

export const SourceSchema = z.strictObject({
  language: LanguageSchema,
  id: ItemIdSchema,
  title: Text,
  publisher: Text,
  url: z.url({ protocol: /^https?$/ }).optional(),
  /** The day the material was read. */
  accessed: z.iso.date(),
  /** The licence as stated, or `unknown`. */
  licence: Text,
  kind: SourceKindSchema,
  body: Markdown,
});

export const GlossaryTermSchema = z.strictObject({
  language: LanguageSchema,
  id: ItemIdSchema,
  term: Text,
  definition: Markdown,
  alsoKnownAs: z.array(Text).optional(),
  sources: References.min(1),
});

export const AreaSchema = z.strictObject({
  language: LanguageSchema,
  id: ItemIdSchema,
  title: Text,
  summary: Text,
  /** Areas recommended first. A recommendation: nothing is locked. */
  requires: References.default([]),
  lessons: References.min(1),
  exam: ExamBlueprintSchema,
});

export const StepSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), body: Markdown }),
  z.strictObject({ type: z.literal('example'), body: Markdown }),
  /** One to three questions from the lesson's own bank, asked on what was just covered. */
  z.strictObject({ type: z.literal('check'), questions: References.min(1).max(3) }),
]);

export const LessonSchema = z.strictObject({
  language: LanguageSchema,
  id: ItemIdSchema,
  title: Text,
  summary: Text,
  /** The concepts the lesson teaches; questions name the ones they test from these. */
  concepts: References.min(1),
  sources: References.min(1),
  exam: ExamBlueprintSchema,
  steps: z.array(StepSchema).min(1),
});

const OptionSchema = z.strictObject({ id: ItemIdSchema, text: Text });

const questionBase = {
  language: LanguageSchema,
  /** The lesson whose bank the question belongs to. */
  lesson: ItemIdSchema,
  id: ItemIdSchema,
  concepts: References.min(1),
  sources: References.min(1),
  prompt: Markdown,
  /** Shown after answering, right or wrong. */
  explanation: Markdown,
};

export const QuestionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...questionBase,
    type: z.literal('single-choice'),
    options: z.array(OptionSchema).min(2),
    answer: ItemIdSchema,
  }),
  z.strictObject({
    ...questionBase,
    type: z.literal('multiple-choice'),
    options: z.array(OptionSchema).min(2),
    answer: References.min(1),
  }),
  z.strictObject({ ...questionBase, type: z.literal('true-false'), answer: z.boolean() }),
  z.strictObject({
    ...questionBase,
    type: z.literal('numeric'),
    answer: z.strictObject({ value: z.number(), unit: z.string().trim(), tolerance: z.number().min(0) }),
  }),
  z.strictObject({
    ...questionBase,
    type: z.literal('short-text'),
    accepted: z.array(Text).min(1),
    caseSensitive: z.boolean().default(false),
  }),
  /** `items` are written in the correct order and shown shuffled. */
  z.strictObject({ ...questionBase, type: z.literal('ordering'), items: z.array(Text).min(2) }),
  z.strictObject({
    ...questionBase,
    type: z.literal('matching'),
    pairs: z.array(z.strictObject({ left: Text, right: Text })).min(2),
  }),
  /** The learner answers in their head and grades themselves against `answer`. */
  z.strictObject({ ...questionBase, type: z.literal('free-recall'), answer: Markdown }),
]);

/** File types a pack may carry. No SVG: it can hold script and would be served from the application's origin. */
export const ASSET_MEDIA_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const;

/** The name of a file in a pack's `assets/` folder. */
export const AssetFileSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'a file name of letters, digits, dots, dashes and underscores');

export const AssetSchema = z.strictObject({
  /** Relative to the pack's root, always under `assets/`. */
  path: z.string().regex(/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/, 'assets/<file name>'),
  mediaType: z.enum(Object.values(ASSET_MEDIA_TYPES)),
  /** The file's bytes, base64-encoded. */
  data: z.base64(),
});

export const PackSchema = z.strictObject({
  formatVersion: z.literal(FORMAT_VERSION),
  /** One entry per language the subject is written in. */
  subject: z.array(SubjectSchema).min(1),
  sources: z.array(SourceSchema).default([]),
  glossary: z.array(GlossaryTermSchema).default([]),
  areas: z.array(AreaSchema).min(1),
  lessons: z.array(LessonSchema).min(1),
  questions: z.array(QuestionSchema).default([]),
  assets: z.array(AssetSchema).default([]),
});

export type ExamBlueprint = z.infer<typeof ExamBlueprintSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;
export type Area = z.infer<typeof AreaSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Pack = z.infer<typeof PackSchema>;

/** The kinds of item a subject is made of, as the catalogue and the API name them. */
export const ItemKindSchema = z.enum(['subject', 'source', 'glossary-term', 'area', 'lesson', 'question', 'asset']);
export type ItemKind = z.infer<typeof ItemKindSchema>;

/**
 * One thing wrong with submitted content, written so that whoever wrote it —
 * often an AI assistant — can correct it from this alone.
 */
export const ContentFaultSchema = z.object({
  /** Stable name of the rule that was broken, such as `unknown-source`. */
  code: z.string(),
  /** The file in a pack folder the fault is in, whether or not the pack was sent as files. */
  file: z.string(),
  /** The item within the file, as `<kind> <id>`, when the fault belongs to one. */
  item: z.string().nullable(),
  /** The path to the offending field within the item, or within the file when there is no item. */
  field: z.string(),
  expected: z.string(),
  found: z.string(),
});
export type ContentFault = z.infer<typeof ContentFaultSchema>;

export const ItemRefSchema = z.object({ kind: ItemKindSchema, id: z.string(), language: z.string().nullable() });
export type ItemRef = z.infer<typeof ItemRefSchema>;

/** What loading a pack changes, or would change on a dry run. */
export const LoadResultSchema = z.object({
  subject: ItemIdSchema,
  /** False on a dry run, and when nothing differed. */
  stored: z.boolean(),
  created: z.boolean(),
  added: z.array(ItemRefSchema),
  changed: z.array(ItemRefSchema),
  /** In the catalogue but not in the pack. Kept for history, no longer offered. */
  retired: z.array(ItemRefSchema),
  unchanged: z.int().min(0),
});
export type LoadResult = z.infer<typeof LoadResultSchema>;

/** What putting one item into a subject changes, or would change on a dry run, and the revision the item is then at. */
export const ItemLoadResultSchema = LoadResultSchema.extend({
  item: ItemRefSchema.extend({ revision: z.int().min(1) }),
});
export type ItemLoadResult = z.infer<typeof ItemLoadResultSchema>;

export const SubjectSummarySchema = z.object({
  id: ItemIdSchema,
  defaultLanguage: LanguageSchema,
  languages: z.array(LanguageSchema),
  title: z.string(),
  summary: z.string(),
  /** Absent for an ordinary subject. */
  role: SubjectRoleSchema.optional(),
});
export type SubjectSummary = z.infer<typeof SubjectSummarySchema>;

/** An area or a lesson as the path shows it, in the language it is shown in. */
const OutlineTextSchema = {
  id: ItemIdSchema,
  /** The language this entry is shown in: the one asked for, or the subject's default where no translation exists. */
  language: LanguageSchema,
  title: z.string(),
  summary: z.string(),
};

export const OutlineLessonSchema = z.object(OutlineTextSchema);
export type OutlineLesson = z.infer<typeof OutlineLessonSchema>;

export const OutlineAreaSchema = z.object({
  ...OutlineTextSchema,
  /** Areas recommended first, by id. A recommendation: nothing is locked. */
  requires: z.array(ItemIdSchema),
  lessons: z.array(OutlineLessonSchema),
});
export type OutlineArea = z.infer<typeof OutlineAreaSchema>;

/**
 * A subject's path: its areas in the recommended order, each with its lessons.
 * The order comes from the default language, so every translation shows the same path.
 */
export const SubjectOutlineSchema = z.object({
  ...SubjectSummarySchema.shape,
  /** The language the subject's own title and summary are shown in. */
  language: LanguageSchema,
  areas: z.array(OutlineAreaSchema),
});
export type SubjectOutline = z.infer<typeof SubjectOutlineSchema>;
