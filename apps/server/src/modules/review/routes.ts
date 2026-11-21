import { OpenAPIHono, z } from '@hono/zod-openapi';
import { DueCountsSchema, DueSchema, ItemIdSchema, TimeZoneSchema } from '@skill-issue/contract';
import type { Catalogue } from '../../core/catalogue/catalogue.js';
import { problem, problemContent } from '../../core/problem.js';
import type { ModuleContext } from '../../core/registry.js';
import { catchUp, memoriesIn, type Memory } from './memory.js';
import { createScheduler, dayIn } from './scheduler.js';

const noSubject = (subjectId: string) => problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`);
const badZone = problem(400, 'timeZone must be a time zone name such as Europe/Stockholm');
const zoneOf = (given: string | undefined) => TimeZoneSchema.optional().safeParse(given);

/** The memories of questions the subject still holds: one removed from it is not asked. */
async function held(catalogue: Catalogue, subjectId: string, memories: readonly Memory[]): Promise<readonly Memory[] | undefined> {
  const shown = await catalogue.questions(subjectId, memories.map((memory) => memory.questionId), undefined);
  if (!shown.ok) {
    return undefined;
  }
  const ids = new Set(shown.value.map(({ question }) => question.id));
  return memories.filter((memory) => ids.has(memory.questionId));
}

/**
 * Due today: scheduling is in whole days, so a question is due once the day
 * it falls due on has come in the learner's own time zone, whatever the hour.
 */
const dueToday = (memory: Memory, now: Date, timeZone: string): boolean => dayIn(memory.dueAt, timeZone) <= dayIn(now, timeZone);

/** Schedules questions to come back, from the learning record, and says which are due. */
export function reviewRoutes({ db, catalogue, record }: ModuleContext): OpenAPIHono {
  const routes = new OpenAPIHono();
  const scheduler = createScheduler();
  const zoneQuery = z.object({ timeZone: TimeZoneSchema.optional() });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/due',
    summary: 'The questions of a subject due for review today, the most overdue first; the next day more fall due; and how long the learner typically takes over one.',
    description:
      'Every answer — in a lesson check, an exam or a review — is an observation of the question, so a question needs no card of its own to be scheduled. Only the first answer of a day counts. "Today" is the day in the time zone given, UTC when none is.',
    request: { params: z.object({ subjectId: ItemIdSchema }), query: zoneQuery },
    responses: {
      200: { description: 'What is due.', content: { 'application/json': { schema: DueSchema } } },
      400: { description: 'The time zone is not one.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/due', async (c) => {
    const subjectId = c.req.param('subjectId');
    const zone = zoneOf(c.req.query('timeZone'));
    if (!zone.success) {
      return c.json(badZone, 400);
    }
    const timeZone = zone.data ?? 'UTC';
    const ready = await scheduler;
    await catchUp(db, record, ready);
    const scheduled = ItemIdSchema.safeParse(subjectId).success ? await held(catalogue, subjectId, await memoriesIn(db, subjectId, ready)) : undefined;
    if (scheduled === undefined) {
      return c.json(noSubject(subjectId), 404);
    }
    const now = new Date();
    // Memories come ordered by when they fell due, so the most overdue lead.
    const questions = scheduled.filter((memory) => dueToday(memory, now, timeZone)).map((memory) => memory.questionId);
    const later = Map.groupBy(scheduled.filter((memory) => !dueToday(memory, now, timeZone)), (memory) => dayIn(memory.dueAt, timeZone));
    const nextDay = [...later.keys()].toSorted()[0];
    const next = nextDay === undefined ? null : { day: nextDay, questions: later.get(nextDay)?.length ?? 0 };
    return c.json({ subjectId, questions, scheduled: scheduled.length, next, typicalAnswerMs: (await record.typicalAnswerMs(subjectId)) ?? null }, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/due',
    summary: 'How many questions each subject has due for review today, and how long the learner typically takes over one.',
    description: 'Every subject with a question scheduled is named, with 0 when none is due today.',
    request: { query: zoneQuery },
    responses: {
      200: { description: 'The counts, by subject.', content: { 'application/json': { schema: DueCountsSchema } } },
      400: { description: 'The time zone is not one.', content: problemContent },
    },
  });
  routes.get('/due', async (c) => {
    const zone = zoneOf(c.req.query('timeZone'));
    if (!zone.success) {
      return c.json(badZone, 400);
    }
    const timeZone = zone.data ?? 'UTC';
    const ready = await scheduler;
    await catchUp(db, record, ready);
    const bySubject = Map.groupBy(await memoriesIn(db, undefined, ready), (memory) => memory.subjectId);
    const now = new Date();
    const subjects: Record<string, { due: number; typicalAnswerMs: number | null }> = {};
    for (const [subjectId, memories] of bySubject) {
      const scheduled = await held(catalogue, subjectId, memories);
      if (scheduled !== undefined && scheduled.length > 0) {
        subjects[subjectId] = { due: scheduled.filter((memory) => dueToday(memory, now, timeZone)).length, typicalAnswerMs: (await record.typicalAnswerMs(subjectId)) ?? null };
      }
    }
    return c.json({ subjects }, 200);
  });

  return routes;
}
