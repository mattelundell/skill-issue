import { OpenAPIHono, z } from '@hono/zod-openapi';
import { ItemIdSchema, SubjectProgressSchema, TimeZoneSchema } from '@skill-issue/contract';
import { createScheduler } from '../../core/memory/memory.js';
import { problem, problemContent } from '../../core/problem.js';
import type { ModuleContext } from '../../core/registry.js';
import { DAYS, progressOf, WEAK_SPOTS } from './progress.js';

const noSubject = (subjectId: string) => problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`);
const badZone = problem(400, 'timeZone must be a time zone name such as Europe/Stockholm');

/** Mastery per lesson and area, and learning over time, computed from the learning record. */
export function progressRoutes({ catalogue, record }: ModuleContext): OpenAPIHono {
  const routes = new OpenAPIHono();
  const scheduler = createScheduler();

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}',
    summary: 'What the learner can recall in a subject: per area and lesson, which lessons are mastered, the last days, and the concepts most often answered wrongly.',
    description: `An expected recall is the scheduling model's chance of recalling a question now, from every answer given to it; a share over several questions is the mean, a question never answered counting as 0. A lesson is mastered while its exam has been passed and the expected recall of its questions is at or above the target. The days are the last ${String(DAYS)} in the time zone given, UTC when none is, each with the answers given and the subject's expected recall at its end. At most ${String(WEAK_SPOTS)} weak spots are named, each with the first lesson on the path that teaches it.`,
    request: { params: z.object({ subjectId: ItemIdSchema }), query: z.object({ timeZone: TimeZoneSchema.optional() }) },
    responses: {
      200: { description: 'The subject’s progress.', content: { 'application/json': { schema: SubjectProgressSchema } } },
      400: { description: 'The time zone is not one.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId', async (c) => {
    const subjectId = c.req.param('subjectId');
    const zone = TimeZoneSchema.optional().safeParse(c.req.query('timeZone'));
    if (!zone.success) {
      return c.json(badZone, 400);
    }
    const banks = ItemIdSchema.safeParse(subjectId).success ? await catalogue.banks(subjectId) : undefined;
    if (banks === undefined) {
      return c.json(noSubject(subjectId), 404);
    }
    const [answers, passed] = await Promise.all([record.answersIn(subjectId), record.passedLessons(subjectId)]);
    return c.json(progressOf(await scheduler, { subjectId, banks, answers, passed, now: new Date(), timeZone: zone.data ?? 'UTC' }), 200);
  });

  return routes;
}
