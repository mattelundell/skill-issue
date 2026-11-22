import { OpenAPIHono, z } from '@hono/zod-openapi';
import { GlossarySchema, ItemIdSchema, LanguageSchema } from '@skill-issue/contract';
import { problem, problemContent } from '../../core/problem.js';
import type { ModuleContext } from '../../core/registry.js';

const noSubject = (subjectId: string) => problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`);
const badLanguage = problem(400, 'language must be a language code such as sv, en or en-GB');

/** A subject's glossary, so a lesson can mark its terms and say what each means. */
export function glossaryRoutes({ catalogue }: ModuleContext): OpenAPIHono {
  const routes = new OpenAPIHono();

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/terms',
    summary: "A subject's glossary terms, each with its definition, the other names it goes by and the titles of the sources it rests on.",
    description:
      "In the order of the pack. Each term, and each source title, is shown in the language asked for where it has been translated, and in the subject's default language where it has not; each says which. A translated term carries only the other names its translation gives.",
    request: { params: z.object({ subjectId: ItemIdSchema }), query: z.object({ language: LanguageSchema.optional() }) },
    responses: {
      200: { description: 'The glossary.', content: { 'application/json': { schema: GlossarySchema } } },
      400: { description: 'The language is not a language code.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/terms', async (c) => {
    const subjectId = c.req.param('subjectId');
    const wanted = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!wanted.success) {
      return c.json(badLanguage, 400);
    }
    const terms = ItemIdSchema.safeParse(subjectId).success ? await catalogue.glossary(subjectId, wanted.data) : undefined;
    return terms === undefined ? c.json(noSubject(subjectId), 404) : c.json(terms, 200);
  });

  return routes;
}
