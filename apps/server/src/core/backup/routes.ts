import { OpenAPIHono, z } from '@hono/zod-openapi';
import { BackupSchema, RestoreResultSchema } from '@skill-issue/contract';
import { bodyLimit } from 'hono/body-limit';
import type { Db } from '../db.js';
import { problem, problemContent } from '../problem.js';
import type { Registry } from '../registry.js';
import { restoreBackup, writeBackup, type RestoreError } from './backup.js';

/** A backup is at most this large on the wire. A subject's assets dominate it; a year of answers is a few megabytes. */
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;

const DryRunSchema = z.enum(['true', 'false']).optional();

function refusal(error: RestoreError): { status: 409 | 422; body: ReturnType<typeof problem> } {
  switch (error.kind) {
    case 'not-empty':
      return {
        status: 409,
        body: problem(409, 'The installation is not empty', `${error.table} already holds rows. A backup restores only into an installation with no subject and no answer, so that nothing in it is mixed with what the backup holds.`),
      };
    case 'other-migrations':
      return {
        status: 409,
        body: problem(
          409,
          'The backup was written by another version',
          `The tables of ${error.owners.join(', ')} have another shape here than when the backup was written. Restore it into the version of Skill Issue that wrote it.`,
        ),
      };
    case 'unowned-table':
      return {
        status: 422,
        body: problem(422, 'The backup holds a table no one here owns', `${error.owner} does not keep ${error.table} in this installation, so it is not restored, and neither is anything else.`),
      };
    case 'does-not-restore':
      return {
        status: 422,
        body: problem(422, 'The backup does not restore', `${error.table === undefined ? 'The rows do not refer to each other as they must' : `A row of ${error.table} does not fit`}: ${error.reason}. Nothing was restored.`),
      };
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/** The whole installation as one file, and back. */
export function backupRoutes(db: Db, registry: Registry, version: string): OpenAPIHono {
  const routes = new OpenAPIHono();

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/backup',
    summary: 'The whole installation as one JSON file: every subject with every revision it has held, the learning record, and what each module keeps about the learner.',
    description:
      'Settings kept in the browser — the interface language, a subject’s content language, the reading mode — are the device’s and not in it. What review schedules is not in it either: it is rebuilt from the learning record.',
    responses: { 200: { description: 'The backup.', content: { 'application/json': { schema: BackupSchema } } } },
  });
  routes.get('/backup', async (c) => {
    const backup = await writeBackup(db, registry, version);
    c.header('content-disposition', `attachment; filename="skill-issue-backup-${backup.createdAt.slice(0, 10)}.json"`);
    return c.json(backup, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/backup',
    summary: 'Restores a backup into an empty installation of the version that wrote it; all of it, or with a fault nothing.',
    request: {
      query: z.object({ dryRun: DryRunSchema }),
      body: { content: { 'application/json': { schema: BackupSchema } } },
    },
    responses: {
      200: { description: 'What was restored, or with dryRun=true what would be.', content: { 'application/json': { schema: RestoreResultSchema } } },
      400: { description: 'The body is not a backup.', content: problemContent },
      409: { description: 'The installation is not empty, or the backup was written by another version.', content: problemContent },
      413: { description: 'The backup is too large.', content: problemContent },
      422: { description: 'A table no one here owns, or a row that does not fit.', content: problemContent },
    },
  });
  routes.post(
    '/backup',
    bodyLimit({
      maxSize: MAX_BACKUP_BYTES,
      onError: (c) => c.json(problem(413, 'The backup is too large', `At most ${MAX_BACKUP_BYTES} bytes may be sent.`), 413),
    }),
    async (c) => {
      const dryRun = DryRunSchema.safeParse(c.req.query('dryRun'));
      if (!dryRun.success) {
        return c.json(problem(400, 'dryRun must be true or false'), 400);
      }
      let json: unknown;
      try {
        json = await c.req.json();
      } catch {
        return c.json(problem(400, 'The body is not a backup', 'It is not JSON.'), 400);
      }
      const backup = BackupSchema.safeParse(json);
      if (!backup.success) {
        const faults = backup.error.issues.map((issue) => `${issue.path.length === 0 ? '(the whole body)' : issue.path.join('.')}: ${issue.message}`);
        return c.json(problem(400, 'The body is not a backup', faults.slice(0, 10).join('; ')), 400);
      }
      const restored = await restoreBackup(db, registry, backup.data, { dryRun: dryRun.data === 'true' });
      if (!restored.ok) {
        const { status, body } = refusal(restored.error);
        return c.json(body, status);
      }
      return c.json(restored.value, 200);
    },
  );

  return routes;
}
