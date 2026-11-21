import { OpenAPIHono, z } from '@hono/zod-openapi';
import { ItemIdSchema, LanguageSchema, SourceLibrarySchema, SourcePageSchema } from '@skill-issue/contract';
import { problem, problemContent } from '../../core/problem.js';
import type { ModuleContext } from '../../core/registry.js';

const noSubject = (subjectId: string) => problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`);
const badLanguage = problem(400, 'language must be a language code such as sv, en or en-GB');

/** Shows a subject's source material, with where each piece came from and what rests on it. */
export function readerRoutes({ catalogue, record }: ModuleContext): OpenAPIHono {
  const routes = new OpenAPIHono();
  const language = { query: z.object({ language: LanguageSchema.optional() }) };

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/sources',
    summary: "A subject's sources, each with its origin, its material, and how many lessons, questions and glossary terms cite it.",
    description:
      "In the order of the pack. Each source is shown in the language asked for where it has been translated, and in the subject's default language where it has not; each says which.",
    request: { params: z.object({ subjectId: ItemIdSchema }), ...language },
    responses: {
      200: { description: 'The library.', content: { 'application/json': { schema: SourceLibrarySchema } } },
      400: { description: 'The language is not a language code.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/sources', async (c) => {
    const subjectId = c.req.param('subjectId');
    const wanted = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!wanted.success) {
      return c.json(badLanguage, 400);
    }
    const library = ItemIdSchema.safeParse(subjectId).success ? await catalogue.sourceLibrary(subjectId, wanted.data) : undefined;
    return library === undefined ? c.json(noSubject(subjectId), 404) : c.json(library, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/sources/{sourceId}',
    summary: 'One source, with the lessons and glossary terms that rest on it.',
    description:
      'Citing lessons are grouped by area in path order, each with the number of questions in its bank that cite the source; the questions themselves are not given. A source the subject no longer holds is answered with its last revision and status "retired", and with how many questions resting on it the learner answered, and how many times, from the learning record.',
    request: { params: z.object({ subjectId: ItemIdSchema, sourceId: ItemIdSchema }), ...language },
    responses: {
      200: { description: 'The source.', content: { 'application/json': { schema: SourcePageSchema } } },
      400: { description: 'The language is not a language code.', content: problemContent },
      404: { description: 'No such subject, or no such source in it.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/sources/:sourceId', async (c) => {
    const subjectId = c.req.param('subjectId');
    const sourceId = c.req.param('sourceId');
    const wanted = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!wanted.success) {
      return c.json(badLanguage, 400);
    }
    if (!ItemIdSchema.safeParse(subjectId).success) {
      return c.json(noSubject(subjectId), 404);
    }
    const noSource = problem(404, 'No such source', `The subject has no source with the id ${JSON.stringify(sourceId)}.`);
    if (!ItemIdSchema.safeParse(sourceId).success) {
      return c.json(noSource, 404);
    }
    const page = await catalogue.sourcePage(subjectId, sourceId, wanted.data);
    if (page.ok) {
      return page.value.status === 'retired' ? c.json({ ...page.value, history: await record.sourceHistory(subjectId, sourceId) }, 200) : c.json(page.value, 200);
    }
    switch (page.error.kind) {
      case 'no-subject':
        return c.json(noSubject(subjectId), 404);
      case 'no-source':
        return c.json(noSource, 404);
      default: {
        const unhandled: never = page.error;
        return unhandled;
      }
    }
  });

  return routes;
}
