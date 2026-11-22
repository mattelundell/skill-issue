import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  AddNoteImageSchema,
  ItemIdSchema,
  LanguageSchema,
  NOTE_IMAGE_MAX_BYTES,
  NOTE_MAX_LENGTH,
  NotebookSchema,
  NotebookSectionSchema,
  NotebookSummaryListSchema,
  NoteImageNameSchema,
  NoteImageSchema,
  NoteImageTypeSchema,
  SaveSectionSchema,
  type NotebookSummary,
  type SectionKind,
} from '@skill-issue/contract';
import { writeZip } from '@skill-issue/pack';
import { bodyLimit } from 'hono/body-limit';
import { problem, problemContent } from '../../core/problem.js';
import type { ModuleContext } from '../../core/registry.js';
import { EXPORT_LANGUAGES, imagesReferenced, isExportLanguage, notebookFiles } from './markdown.js';
import { addImage, allSections, imageNamed, imagesNamed, removeSection, saveSection, sectionsIn } from './store.js';

const noSubject = (subjectId: string) => problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`);

/** The first bytes each kind of image a notebook keeps begins with, so a body claiming to be a PNG is one. */
const SIGNATURES: Readonly<Record<string, (bytes: Uint8Array) => boolean>> = {
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => b[i] === byte),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => String.fromCharCode(...b.subarray(0, 6)) === 'GIF87a' || String.fromCharCode(...b.subarray(0, 6)) === 'GIF89a',
  'image/webp': (b) => String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP',
};

/** Room for an image at its largest, in base64, with the JSON around it. */
const IMAGE_BODY_BYTES = Math.ceil(NOTE_IMAGE_MAX_BYTES / 3) * 4 + 1024;

/** A notebook per subject: a section for each area and lesson, the images added to them, browsing, search and export. */
export function notesRoutes({ db, catalogue }: ModuleContext): OpenAPIHono {
  const routes = new OpenAPIHono();

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/notebooks',
    summary: 'Every subject’s notebook in brief: how many sections hold something, in which areas, and which was written last.',
    responses: { 200: { description: 'One entry per subject the installation holds, in the order the subjects are listed.', content: { 'application/json': { schema: NotebookSummaryListSchema } } } },
  });
  routes.get('/notebooks', async (c) => {
    const subjects = await catalogue.listSubjects();
    const bySubject = Map.groupBy(await allSections(db), (section) => section.subjectId);
    const notebooks: NotebookSummary[] = [];
    for (const { id } of subjects) {
      const sections = bySubject.get(id) ?? [];
      const outline = sections.length === 0 ? undefined : await catalogue.outline(id, undefined);
      const written = new Set(sections.map((section) => `${section.kind}/${section.itemId}`));
      const areasWritten = (outline?.areas ?? []).filter((area) => written.has(`area/${area.id}`) || area.lessons.some((lesson) => written.has(`lesson/${lesson.id}`))).map((area) => area.id);
      const [last] = sections;
      notebooks.push({ subjectId: id, written: sections.length, areasWritten, ...(last === undefined ? {} : { last: { kind: last.kind, itemId: last.itemId, updatedAt: last.updatedAt } }) });
    }
    return c.json({ notebooks }, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/notebook',
    summary: 'The sections written in a subject’s notebook, the most recently written first.',
    description:
      '`q` keeps the sections in which every word given starts a word, ignoring case; anything but letters and digits in it counts as a space. A section on a lesson the subject no longer holds is still listed: the learner wrote it.',
    request: { params: z.object({ subjectId: ItemIdSchema }), query: z.object({ q: z.string().optional() }) },
    responses: {
      200: { description: 'The written sections.', content: { 'application/json': { schema: NotebookSchema } } },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/notebook', async (c) => {
    const subjectId = c.req.param('subjectId');
    if (!ItemIdSchema.safeParse(subjectId).success || (await catalogue.outline(subjectId, undefined)) === undefined) {
      return c.json(noSubject(subjectId), 404);
    }
    return c.json({ subjectId, sections: [...(await sectionsIn(db, subjectId, c.req.query('q')))] }, 200);
  });

  for (const kind of ['area', 'lesson'] as const satisfies readonly SectionKind[]) {
    const plural = kind === 'area' ? 'areas' : 'lessons';
    routes.openAPIRegistry.registerPath({
      method: 'put',
      path: `/subjects/{subjectId}/notebook/${plural}/{itemId}`,
      summary: `Writes the section of a${kind === 'area' ? 'n area' : ' lesson'} in the subject’s notebook; emptied, the section is removed.`,
      description: `Writing again replaces its text and keeps when it was begun. A body of nothing but white space removes the section, and answers 204 whether or not there was one. At most ${NOTE_MAX_LENGTH} characters.`,
      request: { params: z.object({ subjectId: ItemIdSchema, itemId: ItemIdSchema }), body: { content: { 'application/json': { schema: SaveSectionSchema } } } },
      responses: {
        200: { description: 'The section as kept.', content: { 'application/json': { schema: NotebookSectionSchema } } },
        204: { description: 'The section is removed, or there was none.' },
        400: { description: 'The body is not a section.', content: problemContent },
        404: { description: `No such subject, or no such ${kind} in it.`, content: problemContent },
      },
    });
    routes.put(`/subjects/:subjectId/notebook/${plural}/:itemId`, async (c) => {
      const subjectId = c.req.param('subjectId');
      const itemId = c.req.param('itemId');
      let json: unknown;
      try {
        json = await c.req.json();
      } catch {
        return c.json(problem(400, 'The body is not JSON'), 400);
      }
      const body = SaveSectionSchema.safeParse(json);
      if (!body.success) {
        return c.json(problem(400, 'The body is not a section', `Send { "body": <Markdown, at most ${NOTE_MAX_LENGTH} characters> }.`), 400);
      }
      const outline = ItemIdSchema.safeParse(subjectId).success ? await catalogue.outline(subjectId, undefined) : undefined;
      if (outline === undefined) {
        return c.json(noSubject(subjectId), 404);
      }
      const held = kind === 'area' ? outline.areas.some(({ id }) => id === itemId) : outline.areas.some((area) => area.lessons.some(({ id }) => id === itemId));
      if (!held) {
        return c.json(problem(404, `No such ${kind}`, `The subject has no ${kind} with the id ${JSON.stringify(itemId)}.`), 404);
      }
      const at = { subjectId, kind, itemId };
      if (body.data.body.trim() === '') {
        await removeSection(db, at);
        return c.body(null, 204);
      }
      return c.json(await saveSection(db, { ...at, body: body.data.body }), 200);
    });
  }

  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/subjects/{subjectId}/notebook/images',
    summary: 'Keeps an image the learner added to a note, and names it.',
    description: `The image comes as base64 in JSON, since every write is JSON. PNG, JPEG, GIF or WebP, at most ${NOTE_IMAGE_MAX_BYTES} bytes, and its first bytes must be those of the type it claims. A note references it as \`![…](bilder/<name>)\`.`,
    request: { params: z.object({ subjectId: ItemIdSchema }), body: { content: { 'application/json': { schema: AddNoteImageSchema } } } },
    responses: {
      201: { description: 'The image as kept.', content: { 'application/json': { schema: NoteImageSchema } } },
      400: { description: 'Not an image the notebook keeps, or not the type it claims.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
      413: { description: 'Larger than an image may be.', content: problemContent },
    },
  });
  routes.post(
    '/subjects/:subjectId/notebook/images',
    bodyLimit({ maxSize: IMAGE_BODY_BYTES, onError: (c) => c.json(problem(413, 'The image is too large', `An image may be at most ${NOTE_IMAGE_MAX_BYTES} bytes.`), 413) }),
    async (c) => {
      const subjectId = c.req.param('subjectId');
      let json: unknown;
      try {
        json = await c.req.json();
      } catch {
        return c.json(problem(400, 'The body is not JSON'), 400);
      }
      const image = AddNoteImageSchema.safeParse(json);
      if (!image.success) {
        return c.json(problem(400, 'The body is not an image', `Send { "mediaType": one of ${NoteImageTypeSchema.options.join(', ')}, "data": <the image in base64> }.`), 400);
      }
      if (!ItemIdSchema.safeParse(subjectId).success || (await catalogue.outline(subjectId, undefined)) === undefined) {
        return c.json(noSubject(subjectId), 404);
      }
      const bytes = new Uint8Array(Buffer.from(image.data.data, 'base64'));
      if (bytes.length > NOTE_IMAGE_MAX_BYTES) {
        return c.json(problem(413, 'The image is too large', `An image may be at most ${NOTE_IMAGE_MAX_BYTES} bytes.`), 413);
      }
      if (!(SIGNATURES[image.data.mediaType]?.(bytes) ?? false)) {
        return c.json(problem(400, 'Not the image it claims to be', `The data does not begin as ${image.data.mediaType} does.`), 400);
      }
      const kept = await addImage(db, subjectId, image.data.mediaType, bytes);
      return c.json({ name: kept.name, mediaType: image.data.mediaType }, 201);
    },
  );

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/notebook/images/{name}',
    summary: 'An image added to a note.',
    description: 'Served with its media type and no permission to run anything. An image never changes once named, so it may be kept.',
    request: { params: z.object({ subjectId: ItemIdSchema, name: NoteImageNameSchema }) },
    responses: {
      200: { description: 'The image.', content: Object.fromEntries(NoteImageTypeSchema.options.map((type) => [type, { schema: z.string().openapi({ format: 'binary' }) }])) },
      404: { description: 'No such subject, or no such image in its notebook.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/notebook/images/:name', async (c) => {
    const subjectId = c.req.param('subjectId');
    const name = c.req.param('name');
    // An exact lookup on bound values: a name that is not one of ours matches nothing.
    const image = await imageNamed(db, subjectId, name);
    if (image === undefined) {
      return c.json(problem(404, 'No such image', `The notebook has no image ${JSON.stringify(name)}.`), 404);
    }
    return c.body(new Uint8Array(image.data), 200, {
      'content-type': image.mediaType,
      etag: `"${image.digest}"`,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/notebook.zip',
    summary: 'A subject’s notebook as Markdown files in a zip, one per area, with its images beside them in bilder/.',
    description: `\`language\` is the language the subject's titles are given in, the default language where none is translated; \`interface\` is the language of the files' own headings (${EXPORT_LANGUAGES.join(', ')}; sv when none is given). A section on a lesson the subject no longer holds is filed after the path.`,
    request: { params: z.object({ subjectId: ItemIdSchema }), query: z.object({ language: LanguageSchema.optional(), interface: z.enum(EXPORT_LANGUAGES).optional() }) },
    responses: {
      200: { description: 'The notebook, as an attachment.', content: { 'application/zip': { schema: z.string().openapi({ format: 'binary' }) } } },
      400: { description: 'The language is not a language code, or the interface language is not one the export has.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/notebook.zip', async (c) => {
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
    const sections = await sectionsIn(db, subjectId);
    const encoder = new TextEncoder();
    const files = new Map<string, Uint8Array>([...notebookFiles(outline, sections, words)].map(([name, text]) => [name, encoder.encode(text)]));
    for (const image of await imagesNamed(db, subjectId, imagesReferenced(sections.map((section) => section.body)))) {
      files.set(`bilder/${image.name}`, image.data);
    }
    const zip = writeZip(files, subjectId);
    return c.body(new Uint8Array(zip), 200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${subjectId}-anteckningar.zip"`,
    });
  });

  return routes;
}
