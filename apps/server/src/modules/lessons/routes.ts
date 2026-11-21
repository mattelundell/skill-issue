import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  ItemIdSchema,
  LanguageSchema,
  LessonPositionSchema,
  LessonViewSchema,
  ResumeSchema,
  SavePositionSchema,
  SubjectPositionsSchema,
  type LessonPosition,
  type Resume,
  type ShownLesson,
} from '@skill-issue/contract';
import { problem, problemContent } from '../../core/problem.js';
import type { ModuleContext } from '../../core/registry.js';
import { latestPositions, positionOf, positionsIn, savePosition, type StoredPosition } from './position.js';

const noSubject = (subjectId: string) => problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`);
const noLesson = (lessonId: string) => problem(404, 'No such lesson', `The subject offers no lesson with the id ${JSON.stringify(lessonId)}.`);
const badLanguage = problem(400, 'language must be a language code such as sv, en or en-GB');

/** A lesson as the start screen names it. */
const offerOf = (from: ShownLesson) => ({ subjectId: from.subjectId, lessonId: from.id, language: from.language, title: from.title, areaTitle: from.area.title });

const publicPosition = ({ subjectId: _subject, lessonId: _lesson, ...position }: StoredPosition): LessonPosition => position;

/**
 * The step to show on opening a lesson: where the learner stopped, moved back
 * to the last step when a reload has shortened the lesson; the first step for a
 * lesson not begun, or one already gone through to its end.
 */
export function resumeAt(position: LessonPosition | undefined, steps: number): number {
  if (position === undefined || position.step >= position.steps) {
    return 0;
  }
  return Math.min(position.step, steps - 1);
}

/** Runs a lesson step by step and keeps where the learner is in each. */
export function lessonsRoutes({ db, catalogue }: ModuleContext): OpenAPIHono {
  const routes = new OpenAPIHono();
  const params = z.object({ subjectId: ItemIdSchema, lessonId: ItemIdSchema });
  const language = { query: z.object({ language: LanguageSchema.optional() }) };

  /** The lesson, or the problem answer saying why there is none. */
  const lessonOr404 = async (subjectId: string, lessonId: string, wanted: string | undefined) => {
    if (!ItemIdSchema.safeParse(subjectId).success) {
      return { problem: noSubject(subjectId) } as const;
    }
    if (!ItemIdSchema.safeParse(lessonId).success) {
      return { problem: noLesson(lessonId) } as const;
    }
    const lesson = await catalogue.lesson(subjectId, lessonId, wanted);
    if (lesson.ok) {
      return { lesson: lesson.value } as const;
    }
    switch (lesson.error.kind) {
      case 'no-subject':
        return { problem: noSubject(subjectId) } as const;
      case 'no-lesson':
        return { problem: noLesson(lessonId) } as const;
      default: {
        const unhandled: never = lesson.error;
        return unhandled;
      }
    }
  };

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/lessons/{lessonId}',
    summary: 'One lesson with its steps, and where to take it up.',
    description:
      "Steps come from the subject's default language, so a step number means the same step in every language; their text is in the language asked for where the lesson is translated. `resumeAt` is the step to open on.",
    request: { params, ...language },
    responses: {
      200: { description: 'The lesson.', content: { 'application/json': { schema: LessonViewSchema } } },
      400: { description: 'The language is not a language code.', content: problemContent },
      404: { description: 'No such subject, or no such lesson in it.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/lessons/:lessonId', async (c) => {
    const wanted = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!wanted.success) {
      return c.json(badLanguage, 400);
    }
    const found = await lessonOr404(c.req.param('subjectId'), c.req.param('lessonId'), wanted.data);
    if ('problem' in found) {
      return c.json(found.problem, 404);
    }
    const { lesson } = found;
    const position = await positionOf(db, lesson.subjectId, lesson.id);
    return c.json(
      {
        lesson,
        position: position === undefined ? null : publicPosition(position),
        resumeAt: resumeAt(position, lesson.steps.length),
        changedSince: position !== undefined && position.revision !== lesson.revision,
      },
      200,
    );
  });

  routes.openAPIRegistry.registerPath({
    method: 'put',
    path: '/subjects/{subjectId}/lessons/{lessonId}/position',
    summary: 'Records the step on screen; the step after the last marks the lesson gone through.',
    description:
      'The revision is the one the steps were drawn from. When the lesson has been reloaded changed since, the answer is 409 and the caller fetches the lesson again, so a step number is never stored against steps the learner did not see.',
    request: { params, body: { content: { 'application/json': { schema: SavePositionSchema } } } },
    responses: {
      200: { description: 'Where the learner now is.', content: { 'application/json': { schema: LessonPositionSchema } } },
      400: { description: 'The body is not a position, or its step lies beyond the lesson’s end.', content: problemContent },
      404: { description: 'No such subject, or no such lesson in it.', content: problemContent },
      409: { description: 'The lesson has changed since the caller drew it.', content: problemContent },
    },
  });
  routes.put('/subjects/:subjectId/lessons/:lessonId/position', async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json(problem(400, 'The body is not JSON'), 400);
    }
    const body = SavePositionSchema.safeParse(json);
    if (!body.success) {
      return c.json(problem(400, 'The body is not a position', 'Send { "step": <integer from 0>, "revision": <integer from 1> }.'), 400);
    }
    const found = await lessonOr404(c.req.param('subjectId'), c.req.param('lessonId'), undefined);
    if ('problem' in found) {
      return c.json(found.problem, 404);
    }
    const { lesson } = found;
    if (body.data.revision !== lesson.revision) {
      return c.json(
        problem(409, 'The lesson has changed', `The lesson is at revision ${lesson.revision}, not ${body.data.revision}. Fetch it again and resume from there.`),
        409,
      );
    }
    if (body.data.step > lesson.steps.length) {
      return c.json(problem(400, 'No such step', `The lesson has ${lesson.steps.length} steps; the step after the last is ${lesson.steps.length}.`), 400);
    }
    const saved = await savePosition(db, { subjectId: lesson.subjectId, lessonId: lesson.id, step: body.data.step, steps: lesson.steps.length, revision: lesson.revision });
    return c.json(publicPosition(saved), 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/positions',
    summary: 'Where the learner is in every lesson of a subject they have opened.',
    request: { params: z.object({ subjectId: ItemIdSchema }) },
    responses: {
      200: { description: 'The positions, by lesson id.', content: { 'application/json': { schema: SubjectPositionsSchema } } },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/positions', async (c) => {
    const subjectId = c.req.param('subjectId');
    const outline = ItemIdSchema.safeParse(subjectId).success ? await catalogue.outline(subjectId, undefined) : undefined;
    if (outline === undefined) {
      return c.json(noSubject(subjectId), 404);
    }
    const offered = new Set(outline.areas.flatMap((area) => area.lessons.map((lesson) => lesson.id)));
    const lessons = Object.fromEntries(
      (await positionsIn(db, subjectId)).filter((position) => offered.has(position.lessonId)).map((position) => [position.lessonId, publicPosition(position)]),
    );
    return c.json({ subjectId, lessons }, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/resume',
    summary: 'Where the learner left off, across every subject.',
    description:
      'The lesson last moved in, when it is unfinished; else the first lesson after it on its subject’s path that has not been gone through; else nothing. Lessons a subject no longer offers are passed over. `started` lists the subjects in which any lesson has been begun.',
    request: language,
    responses: {
      200: { description: 'The offer, if any.', content: { 'application/json': { schema: ResumeSchema } } },
      400: { description: 'The language is not a language code.', content: problemContent },
    },
  });
  routes.get('/resume', async (c) => {
    const wanted = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!wanted.success) {
      return c.json(badLanguage, 400);
    }
    const positions = await latestPositions(db);
    const resume: Resume = { offer: null, started: [...new Set(positions.map((position) => position.subjectId))].toSorted() };
    for (const position of positions) {
      const lesson = await catalogue.lesson(position.subjectId, position.lessonId, wanted.data);
      if (!lesson.ok) {
        continue;
      }
      if (position.step < position.steps) {
        return c.json({ ...resume, offer: { kind: 'continue' as const, ...offerOf(lesson.value), step: resumeAt(position, lesson.value.steps.length), steps: lesson.value.steps.length } }, 200);
      }
      const outline = await catalogue.outline(position.subjectId, wanted.data);
      const path = outline?.areas.flatMap((area) => area.lessons.map((each) => each.id)) ?? [];
      const finished = new Set(positions.filter((each) => each.subjectId === position.subjectId && each.finishedAt !== null).map((each) => each.lessonId));
      const next = path.slice(path.indexOf(position.lessonId) + 1).find((id) => !finished.has(id));
      if (next === undefined) {
        return c.json(resume, 200);
      }
      const nextLesson = await catalogue.lesson(position.subjectId, next, wanted.data);
      return c.json(nextLesson.ok ? { ...resume, offer: { kind: 'next' as const, ...offerOf(nextLesson.value) } } : resume, 200);
    }
    return c.json(resume, 200);
  });

  return routes;
}
