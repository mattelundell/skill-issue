import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  ASSET_MEDIA_TYPES,
  AssetFileSchema,
  ItemLoadResultSchema,
  ItemIdSchema,
  LanguageSchema,
  LoadResultSchema,
  PackSchema,
  SubjectOutlineSchema,
  SubjectSummarySchema,
  type ContentFault,
  type ItemKind,
  type Pack,
  type Problem,
  type Result,
} from '@skill-issue/contract';
import { checkPack, checkPackFiles, DEFAULT_LIMITS, encodePack, limitFaults, readZip, writeZip } from '@skill-issue/pack';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { problem, problemContent } from '../../core/problem.js';
import type { ModuleContext } from '../../core/registry.js';

/** A zip archive is at most this large on the wire; unpacked, the pack limits apply. */
const MAX_BODY_BYTES = DEFAULT_LIMITS.maxTotalBytes;

const DryRunSchema = z.enum(['true', 'false']).optional();

async function packFromRequest(c: Context): Promise<Result<Pack, Problem>> {
  const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  const body = new Uint8Array(await c.req.arrayBuffer());
  let checked: Result<Pack, ContentFault[]>;
  if (type === 'application/json') {
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(body));
    } catch (thrown) {
      // Not propagated: the sender learns what was wrong with what they sent.
      return { ok: false, error: problem(400, 'The body is not JSON', thrown instanceof Error ? thrown.message : String(thrown)) };
    }
    checked = checkPack(json);
  } else if (type === 'application/zip') {
    const files = readZip(body);
    checked = files.ok ? checkPackFiles(files.value) : files;
  } else {
    return { ok: false, error: problem(415, 'Send a pack as application/json or application/zip', `Content-Type was ${JSON.stringify(type ?? '')}`) };
  }
  if (!checked.ok) {
    const count = checked.error.length;
    return {
      ok: false,
      error: problem(422, 'The pack was not loaded', `${count} ${count === 1 ? 'fault' : 'faults'}; correct each and send the pack again.`, checked.error),
    };
  }
  return checked;
}

/**
 * The collections one item at a time may be put into, by the name the address
 * and the pack both use, with the kind each holds. Areas and the subject are
 * not among them: an area and its new lesson name each other, so neither can
 * be added alone, and both come with a pack.
 */
const SINGLE_ITEMS = { questions: 'question', lessons: 'lesson', sources: 'source', glossary: 'glossary-term' } as const satisfies Record<string, ItemKind>;
type SingleCollection = keyof typeof SINGLE_ITEMS;
const isSingleCollection = (name: string): name is SingleCollection => Object.hasOwn(SINGLE_ITEMS, name);

function stringField(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(field in value)) {
    return undefined;
  }
  const found: unknown = Reflect.get(value, field);
  return typeof found === 'string' ? found : undefined;
}

/** The subject with `item` in place of the entry of the same id and language, or added after the others; then checked whole, and against the limits a pack is read under. */
function withItem(current: Pack, collection: SingleCollection, item: unknown, language: string, id: string): Result<Pack, readonly ContentFault[]> {
  const entries: readonly { readonly id: string; readonly language: string }[] = current[collection];
  const at = entries.findIndex((entry) => entry.id === id && entry.language === language);
  const items: unknown[] = at === -1 ? [...entries, item] : entries.map((entry, index) => (index === at ? item : entry));
  const checked = checkPack({ ...current, [collection]: items });
  if (!checked.ok) {
    return checked;
  }
  // A subject grown an item at a time must still fit in a pack, or it could never be exported and loaded again.
  const tooLarge = limitFaults(checked.value);
  return tooLarge.length > 0 ? { ok: false, error: tooLarge } : checked;
}

/** Accepts, validates, versions and exports subject material. */
export function contentRoutes({ catalogue }: ModuleContext): OpenAPIHono {
  const routes = new OpenAPIHono();

  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/packs',
    summary: 'Load a subject pack, or with dryRun=true only check it and report what would change.',
    description:
      'A pack whose subject already exists updates that subject: changed items get a new revision, and items no longer in the pack are retired. Sending the same pack twice changes nothing. A rejected pack is answered with every fault found, each naming the file, item and field it is in.',
    request: {
      query: z.object({ dryRun: DryRunSchema }),
      body: {
        required: true,
        content: {
          'application/json': { schema: PackSchema },
          'application/zip': { schema: z.string().openapi({ format: 'binary' }) },
        },
      },
    },
    responses: {
      200: { description: 'Checked, and stored unless it was a dry run or nothing differed.', content: { 'application/json': { schema: LoadResultSchema } } },
      201: { description: 'A new subject, stored.', content: { 'application/json': { schema: LoadResultSchema } } },
      400: { description: 'The body is not JSON, or the query is wrong.', content: problemContent },
      413: { description: 'The body is larger than a pack may be.', content: problemContent },
      415: { description: 'Neither JSON nor a zip archive.', content: problemContent },
      422: { description: 'The pack breaks the format; `faults` lists every fault.', content: problemContent },
    },
  });
  routes.post(
    '/packs',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(problem(413, 'The pack is too large', `At most ${MAX_BODY_BYTES} bytes may be sent.`), 413),
    }),
    async (c) => {
      const dryRun = DryRunSchema.safeParse(c.req.query('dryRun'));
      if (!dryRun.success) {
        return c.json(problem(400, 'dryRun must be true or false'), 400);
      }
      const pack = await packFromRequest(c);
      if (!pack.ok) {
        return c.json(pack.error, pack.error.status === 400 ? 400 : pack.error.status === 415 ? 415 : 422);
      }
      const result = await catalogue.load(pack.value, { dryRun: dryRun.data === 'true' });
      return c.json(result, result.created && result.stored ? 201 : 200);
    },
  );

  routes.openAPIRegistry.registerPath({
    method: 'put',
    path: '/subjects/{subjectId}/{collection}/{itemId}',
    summary: 'Put one question, lesson, source or glossary term into an existing subject, or with dryRun=true only check it.',
    description:
      'The item replaces the one with the same id in the same language, or is added. The whole subject as it would then stand is checked, so an item that breaks a reference anywhere is refused with every fault found; nothing else is changed or retired. A changed item gets a new revision; the same item sent again changes nothing. A new lesson must be listed by an area, so it comes with a pack.',
    request: {
      params: z.object({ subjectId: ItemIdSchema, collection: z.enum(['questions', 'lessons', 'sources', 'glossary']), itemId: ItemIdSchema }),
      query: z.object({ dryRun: DryRunSchema }),
      body: { required: true, content: { 'application/json': { schema: z.looseObject({}).openapi({ description: 'A question, lesson, source or glossary term, as it is written in a pack sent as JSON.' }) } } },
    },
    responses: {
      200: { description: 'Checked, and stored unless it was a dry run or nothing differed.', content: { 'application/json': { schema: ItemLoadResultSchema } } },
      201: { description: 'A new item, stored.', content: { 'application/json': { schema: ItemLoadResultSchema } } },
      400: { description: 'The body is not JSON, its id is not the address\'s, or the query is wrong.', content: problemContent },
      404: { description: 'No such subject, or no such collection.', content: problemContent },
      413: { description: 'The body is larger than a pack may be.', content: problemContent },
      415: { description: 'Not JSON.', content: problemContent },
      422: { description: 'The subject would break the format, or no longer fit in a pack; `faults` lists every fault.', content: problemContent },
    },
  });
  routes.put(
    '/subjects/:subjectId/:collection/:itemId',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(problem(413, 'The item is too large', `At most ${MAX_BODY_BYTES} bytes may be sent.`), 413),
    }),
    async (c) => {
      const subjectId = c.req.param('subjectId');
      const collection = c.req.param('collection');
      const itemId = c.req.param('itemId');
      const noSubject = problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`);
      if (!isSingleCollection(collection)) {
        return c.json(problem(404, 'No such collection', `One item at a time goes into ${Object.keys(SINGLE_ITEMS).join(', ')}.`), 404);
      }
      if (!ItemIdSchema.safeParse(subjectId).success) {
        return c.json(noSubject, 404);
      }
      const dryRun = DryRunSchema.safeParse(c.req.query('dryRun'));
      if (!dryRun.success) {
        return c.json(problem(400, 'dryRun must be true or false'), 400);
      }
      const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
      if (type !== 'application/json') {
        return c.json(problem(415, 'Send the item as application/json', `Content-Type was ${JSON.stringify(type ?? '')}`), 415);
      }
      let item: unknown;
      try {
        item = JSON.parse(await c.req.text());
      } catch (thrown) {
        // Not propagated: the sender learns what was wrong with what they sent.
        return c.json(problem(400, 'The body is not JSON', thrown instanceof Error ? thrown.message : String(thrown)), 400);
      }
      const id = stringField(item, 'id');
      if (id !== undefined && id !== itemId) {
        return c.json(problem(400, 'The id in the address is not the item’s', `The address names ${JSON.stringify(itemId)}; the item is ${JSON.stringify(id)}.`), 400);
      }
      const language = stringField(item, 'language') ?? '';
      const kind = SINGLE_ITEMS[collection];
      const updated = await catalogue.update(subjectId, { kind, id: itemId, language }, (current) => withItem(current, collection, item, language, itemId), { dryRun: dryRun.data === 'true' });
      if (!updated.ok) {
        if (updated.error.kind === 'no-subject') {
          return c.json(noSubject, 404);
        }
        const count = updated.error.faults.length;
        return c.json(problem(422, 'The item was not stored', `${count} ${count === 1 ? 'fault' : 'faults'} in the subject as it would stand; correct each and send the item again.`, [...updated.error.faults]), 422);
      }
      const { value } = updated;
      const added = value.stored && value.added.some((ref) => ref.kind === kind && ref.id === itemId && ref.language === language);
      return c.json(value, added ? 201 : 200);
    },
  );

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects',
    summary: 'Every subject loaded, with the languages it is written in.',
    responses: { 200: { description: 'The subjects.', content: { 'application/json': { schema: z.array(SubjectSummarySchema) } } } },
  });
  routes.get('/subjects', async (c) => c.json(await catalogue.listSubjects(), 200));

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}',
    summary: "A subject's path: its areas in the recommended order, each with its lessons.",
    description:
      'Every area and lesson is shown in the language asked for where it has been translated, and in the subject\'s default language where it has not; each says which language it is in.',
    request: { params: z.object({ subjectId: ItemIdSchema }), query: z.object({ language: LanguageSchema.optional() }) },
    responses: {
      200: { description: 'The outline.', content: { 'application/json': { schema: SubjectOutlineSchema } } },
      400: { description: 'The language is not a language code.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId', async (c) => {
    const subjectId = c.req.param('subjectId');
    const language = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!language.success) {
      return c.json(problem(400, 'language must be a language code such as sv, en or en-GB'), 400);
    }
    const outline = ItemIdSchema.safeParse(subjectId).success ? await catalogue.outline(subjectId, language.data) : undefined;
    if (outline === undefined) {
      return c.json(problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`), 404);
    }
    return c.json(outline, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/pack',
    summary: 'Export a subject as a pack: JSON, or with format=zip the pack folder as a zip archive.',
    description: 'What is exported loads unchanged into this or any other installation. It holds the subject only, nothing about who studied it.',
    request: { params: z.object({ subjectId: ItemIdSchema }), query: z.object({ format: z.enum(['json', 'zip']).optional() }) },
    responses: {
      200: {
        description: 'The pack.',
        content: { 'application/json': { schema: PackSchema }, 'application/zip': { schema: z.string().openapi({ format: 'binary' }) } },
      },
      400: { description: 'The format is neither json nor zip.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/pack', async (c) => {
    const subjectId = c.req.param('subjectId');
    const format = c.req.query('format') ?? 'json';
    if (format !== 'json' && format !== 'zip') {
      return c.json(problem(400, 'format must be json or zip'), 400);
    }
    const pack = ItemIdSchema.safeParse(subjectId).success ? await catalogue.exportPack(subjectId) : undefined;
    if (pack === undefined) {
      return c.json(problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`), 404);
    }
    if (format === 'json') {
      return c.json(pack, 200);
    }
    const archive = writeZip(encodePack(pack), subjectId);
    return c.body(archive.slice().buffer, 200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${subjectId}.zip"`,
    });
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/schema/pack.json',
    summary: 'The JSON Schema of a pack sent as JSON: the authority on the format.',
    responses: { 200: { description: 'JSON Schema, draft 2020-12.', content: { 'application/schema+json': { schema: z.looseObject({}) } } } },
  });
  const packJsonSchema = z.toJSONSchema(PackSchema, { io: 'input' });
  routes.get('/schema/pack.json', (c) => c.json(packJsonSchema, 200, { 'content-type': 'application/schema+json' }));

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/assets/{file}',
    summary: "One of a subject's files, such as an image a lesson or a source shows.",
    description:
      'Served with its media type and no permission to run anything, since it comes from the application\'s own address. The ETag changes whenever the file does; a request holding the current one is answered 304.',
    request: { params: z.object({ subjectId: ItemIdSchema, file: AssetFileSchema }) },
    responses: {
      200: { description: 'The file.', content: Object.fromEntries(Object.values(ASSET_MEDIA_TYPES).map((type) => [type, { schema: z.string().openapi({ format: 'binary' }) }])) },
      304: { description: 'The copy the caller holds is the current one.' },
      404: { description: 'No such subject, or no such file in it.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/assets/:file', async (c) => {
    const subjectId = c.req.param('subjectId');
    const file = c.req.param('file');
    const noFile = problem(404, 'No such file', `The subject has no file ${JSON.stringify(`assets/${file}`)}.`);
    // An exact lookup on bound values: a name that climbs out of assets/, or any other junk, matches nothing.
    const asset = await catalogue.asset(subjectId, `assets/${file}`);
    if (asset === undefined) {
      return c.json(noFile, 404);
    }
    const etag = `"${asset.digest}"`;
    // Revalidated on every use, so a reloaded subject's new image shows at once; unchanged ones cost a 304.
    const headers = {
      etag,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    };
    if (c.req.header('if-none-match') === etag) {
      return c.body(null, 304, headers);
    }
    return c.body(new Uint8Array(asset.data), 200, { ...headers, 'content-type': asset.mediaType });
  });

  return routes;
}
