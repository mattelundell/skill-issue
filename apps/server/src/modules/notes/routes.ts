import { OpenAPIHono, z } from '@hono/zod-openapi';
import { ItemIdSchema, LanguageSchema, NoteListSchema, NoteSchema, NOTE_MAX_LENGTH, SaveNoteSchema } from '@skill-issue/contract';
import { problem, problemContent } from '../../core/problem.js';
import type { ModuleContext } from '../../core/registry.js';
import { EXPORT_LANGUAGES, isExportLanguage, notesAsMarkdown, type FiledLesson } from './markdown.js';
import { notesIn, removeNote, saveNote } from './store.js';

const noSubject = (subjectId: string) => problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`);
const noLesson = (lessonId: string) => problem(404, 'No such lesson', `The subject offers no lesson with the id ${JSON.stringify(lessonId)}.`);
const STEP = /^(?:0|[1-9][0-9]{0,5})$/;

/** Notes written beside a lesson, filed by lesson and step; browsing and search. */
export function notesRoutes({ db, catalogue }: ModuleContext): OpenAPIHono {
  const routes = new OpenAPIHono();

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/notes',
    summary: 'The notes written in a subject, the most recently written first; or one lesson’s, in step order.',
    description:
      '`q` keeps the notes in which every word given starts a word, ignoring case; anything but letters and digits in it counts as a space. A note on a lesson the subject no longer holds is still listed: the learner wrote it.',
    request: {
      params: z.object({ subjectId: ItemIdSchema }),
      query: z.object({ q: z.string().optional(), lesson: ItemIdSchema.optional() }),
    },
    responses: {
      200: { description: 'The notes.', content: { 'application/json': { schema: NoteListSchema } } },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/notes', async (c) => {
    const subjectId = c.req.param('subjectId');
    if (!ItemIdSchema.safeParse(subjectId).success || (await catalogue.outline(subjectId, undefined)) === undefined) {
      return c.json(noSubject(subjectId), 404);
    }
    const lessonId = c.req.query('lesson');
    const query = c.req.query('q');
    const notes = await notesIn(db, subjectId, { ...(lessonId === undefined ? {} : { lessonId }), ...(query === undefined ? {} : { query }) });
    return c.json({ subjectId, notes: [...notes] }, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/notes.md',
    summary: 'A subject’s notes as one Markdown file, filed by area, lesson and step in the order of the path.',
    description: `\`language\` is the language the subject's titles are given in, the default language where none is translated; \`interface\` is the language of the file's own headings (${EXPORT_LANGUAGES.join(', ')}; sv when none is given). A note on a lesson the subject no longer holds is filed after the path.`,
    request: {
      params: z.object({ subjectId: ItemIdSchema }),
      query: z.object({ language: LanguageSchema.optional(), interface: z.enum(EXPORT_LANGUAGES).optional() }),
    },
    responses: {
      200: { description: 'The notes, as an attachment.', content: { 'text/markdown': { schema: z.string() } } },
      400: { description: 'The language is not a language code, or the interface language is not one the export has.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/notes.md', async (c) => {
    const subjectId = c.req.param('subjectId');
    const language = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!language.success) {
      return c.json(problem(400, 'language must be a language code such as sv, en or en-GB'), 400);
    }
    const words = c.req.query('interface') ?? 'sv';
    if (!isExportLanguage(words)) {
      return c.json(problem(400, 'No such interface language', `The export's headings are written in ${EXPORT_LANGUAGES.join(' and ')}.`), 400);
    }
    const outline = ItemIdSchema.safeParse(subjectId).success ? await catalogue.outline(subjectId, language.data) : undefined;
    if (outline === undefined) {
      return c.json(noSubject(subjectId), 404);
    }
    const notes = await notesIn(db, subjectId);
    const lessons = new Map<string, FiledLesson>();
    for (const lessonId of new Set(notes.map((note) => note.lessonId))) {
      const lesson = await catalogue.lesson(subjectId, lessonId, language.data);
      if (lesson.ok) {
        lessons.set(lessonId, lesson.value);
      }
    }
    c.header('content-type', 'text/markdown; charset=utf-8');
    c.header('content-disposition', `attachment; filename="${subjectId}-notes.md"`);
    return c.body(notesAsMarkdown(outline, lessons, notes, words), 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'put',
    path: '/subjects/{subjectId}/lessons/{lessonId}/steps/{step}',
    summary: 'Writes the note at a step of a lesson; emptied, the note is removed.',
    description: `One note per step, counted from 0. Writing again replaces its text and keeps when it was begun. A body of nothing but white space removes the note, and answers 204 whether or not there was one. At most ${NOTE_MAX_LENGTH} characters.`,
    request: {
      params: z.object({ subjectId: ItemIdSchema, lessonId: ItemIdSchema, step: z.string().regex(STEP) }),
      body: { content: { 'application/json': { schema: SaveNoteSchema } } },
    },
    responses: {
      200: { description: 'The note as kept.', content: { 'application/json': { schema: NoteSchema } } },
      204: { description: 'The note is removed, or there was none.' },
      400: { description: 'The body is not a note, or the step lies beyond the lesson.', content: problemContent },
      404: { description: 'No such subject, or no such lesson in it.', content: problemContent },
    },
  });
  routes.put('/subjects/:subjectId/lessons/:lessonId/steps/:step', async (c) => {
    const subjectId = c.req.param('subjectId');
    const lessonId = c.req.param('lessonId');
    const stepText = c.req.param('step');
    if (!STEP.test(stepText)) {
      return c.json(problem(400, 'No such step', 'A step is a whole number from 0.'), 400);
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json(problem(400, 'The body is not JSON'), 400);
    }
    const body = SaveNoteSchema.safeParse(json);
    if (!body.success) {
      return c.json(problem(400, 'The body is not a note', `Send { "body": <Markdown, at most ${NOTE_MAX_LENGTH} characters> }.`), 400);
    }
    if (!ItemIdSchema.safeParse(subjectId).success) {
      return c.json(noSubject(subjectId), 404);
    }
    if (!ItemIdSchema.safeParse(lessonId).success) {
      return c.json(noLesson(lessonId), 404);
    }
    const lesson = await catalogue.lesson(subjectId, lessonId, undefined);
    if (!lesson.ok) {
      return c.json(lesson.error.kind === 'no-subject' ? noSubject(subjectId) : noLesson(lessonId), 404);
    }
    const step = Number(stepText);
    const steps = lesson.value.steps.length;
    if (step >= steps) {
      return c.json(problem(400, 'No such step', `The lesson has ${steps} steps, numbered from 0 to ${steps - 1}.`), 400);
    }
    const at = { subjectId, lessonId, step };
    if (body.data.body.trim() === '') {
      await removeNote(db, at);
      return c.body(null, 204);
    }
    return c.json(await saveNote(db, { ...at, body: body.data.body }), 200);
  });

  return routes;
}
