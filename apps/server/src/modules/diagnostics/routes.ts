import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  EVENT_BATCH_MAX,
  EventsTakenSchema,
  InterfaceEventBatchSchema,
  RECORDING_MAX_EVENTS,
  RecordingListSchema,
  RecordingSchema,
  RecordingStateSchema,
  SessionFileSchema,
  StartRecordingSchema,
  type SessionFile,
} from '@skill-issue/contract';
import type { Context } from 'hono';
import { problem, problemContent } from '../../core/problem.js';
import type { ModuleContext } from '../../core/registry.js';
import { appendEvents, endRecording, eventsOf, recording, recordings, recordingUnderWay, removeRecording, startRecording } from './store.js';

const ID = /^[1-9][0-9]{0,15}$/;
const IdParams = z.object({ id: z.string().regex(ID) });
const noRecording = (id: string) => problem(404, 'No such recording', `No recording has the id ${JSON.stringify(id)}.`);

async function jsonBody(c: Context): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

/** Recording a study session: started and ended by the learner, fed by the browser, exported as one file. */
export function diagnosticsRoutes({ db, version }: ModuleContext): OpenAPIHono {
  const routes = new OpenAPIHono();

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/recording',
    summary: 'The recording under way, or null when nothing is being recorded.',
    responses: { 200: { description: 'What is being recorded.', content: { 'application/json': { schema: RecordingStateSchema } } } },
  });
  routes.get('/recording', async (c) => c.json({ recording: (await recordingUnderWay(db)) ?? null }, 200));

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/recordings',
    summary: 'Every recording kept, the most recently started first.',
    responses: { 200: { description: 'The recordings.', content: { 'application/json': { schema: RecordingListSchema } } } },
  });
  routes.get('/recordings', async (c) => c.json({ recordings: [...(await recordings(db))] }, 200));

  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/recordings',
    summary: 'Starts recording: every API call the server answers from now on, and the interface events the browser sends.',
    description: `At most one recording is under way; asked to start while one is, the server answers with that one. A recording ends itself, as full, at ${RECORDING_MAX_EVENTS} events.`,
    request: { body: { content: { 'application/json': { schema: StartRecordingSchema } } } },
    responses: {
      201: { description: 'Recording started.', content: { 'application/json': { schema: RecordingSchema } } },
      200: { description: 'A recording was already under way.', content: { 'application/json': { schema: RecordingSchema } } },
      400: { description: 'The body is not a start.', content: problemContent },
    },
  });
  routes.post('/recordings', async (c) => {
    const json = await jsonBody(c);
    const body = json.ok ? StartRecordingSchema.safeParse(json.value) : undefined;
    if (body?.success !== true) {
      return c.json(problem(400, 'The body is not a start', 'Send { "client": { "userAgent", "viewport": { "width", "height" }, "interfaceLanguage" } }, every field optional, or {}.'), 400);
    }
    const started = await startRecording(db, body.data.client ?? {});
    return c.json(started.recording, started.kind === 'started' ? 201 : 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/recordings/{id}/end',
    summary: 'Stops a recording. One already ended is left as it ended.',
    request: { params: IdParams },
    responses: {
      200: { description: 'The recording as it ended.', content: { 'application/json': { schema: RecordingSchema } } },
      404: { description: 'No such recording.', content: problemContent },
    },
  });
  routes.post('/recordings/:id/end', async (c) => {
    const id = c.req.param('id');
    const ended = ID.test(id) ? await endRecording(db, Number(id)) : undefined;
    return ended === undefined ? c.json(noRecording(id), 404) : c.json(ended, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/recordings/{id}/events',
    summary: 'Adds what the learner did in the browser to the recording under way.',
    description: `At most ${EVENT_BATCH_MAX} events at a time. Nothing typed into a field is taken: a key pressed in one is recorded only as Enter, Escape or Tab. When the recording fills up, what does not fit is dropped and \`recording\` answers false.`,
    request: { params: IdParams, body: { content: { 'application/json': { schema: InterfaceEventBatchSchema } } } },
    responses: {
      200: { description: 'How many events were kept, and whether the recording is still under way.', content: { 'application/json': { schema: EventsTakenSchema } } },
      400: { description: 'The body is not a batch of interface events.', content: problemContent },
      404: { description: 'No such recording.', content: problemContent },
      409: { description: 'The recording has ended.', content: problemContent },
    },
  });
  routes.post('/recordings/:id/events', async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) {
      return c.json(noRecording(id), 404);
    }
    const json = await jsonBody(c);
    const body = json.ok ? InterfaceEventBatchSchema.safeParse(json.value) : undefined;
    if (body?.success !== true) {
      const where = body === undefined ? 'The body is not JSON.' : body.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return c.json(problem(400, 'The body is not a batch of interface events', where), 400);
    }
    const appended = await appendEvents(db, Number(id), body.data.events.map((event) => ({ source: 'interface' as const, event })));
    if (appended.kind === 'taken') {
      return c.json({ taken: appended.taken, recording: appended.underWay }, 200);
    }
    return (await recording(db, Number(id))) === undefined
      ? c.json(noRecording(id), 404)
      : c.json(problem(409, 'The recording has ended', 'Start a new recording to record more.'), 409);
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/recordings/{id}/export',
    summary: 'A recording as one JSON file: the recording, and every event in the order it happened.',
    description: 'A recording under way can be exported too: the file holds what it has seen so far.',
    request: { params: IdParams },
    responses: {
      200: { description: 'The recording, as an attachment.', content: { 'application/json': { schema: SessionFileSchema } } },
      404: { description: 'No such recording.', content: problemContent },
    },
  });
  routes.get('/recordings/:id/export', async (c) => {
    const id = c.req.param('id');
    const kept = ID.test(id) ? await recording(db, Number(id)) : undefined;
    if (kept === undefined) {
      return c.json(noRecording(id), 404);
    }
    const file: SessionFile = {
      format: 'skill-issue-session',
      formatVersion: 1,
      appVersion: version,
      exportedAt: new Date().toISOString(),
      recording: kept,
      events: [...(await eventsOf(db, kept.id))],
    };
    c.header('content-disposition', `attachment; filename="skill-issue-session-${kept.id}-${kept.startedAt.slice(0, 10)}.json"`);
    return c.json(file, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'delete',
    path: '/recordings/{id}',
    summary: 'Removes a recording and everything it saw; one under way stops.',
    request: { params: IdParams },
    responses: {
      204: { description: 'Removed.' },
      404: { description: 'No such recording.', content: problemContent },
    },
  });
  routes.delete('/recordings/:id', async (c) => {
    const id = c.req.param('id');
    return ID.test(id) && (await removeRecording(db, Number(id))) ? c.body(null, 204) : c.json(noRecording(id), 404);
  });

  return routes;
}
