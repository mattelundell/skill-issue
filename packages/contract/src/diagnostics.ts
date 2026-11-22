import { z } from 'zod';

/**
 * A recording of a study session, for finding faults: what the learner did in
 * the interface, every API call the server answered, and every error. It is
 * switched on and off by the learner, kept on this machine, and exported as one
 * file. Nothing typed into a field is recorded, only that a key was pressed there.
 */

/**
 * An address as a recording keeps it: the path, and the names in its query
 * without their values, since a value may be what the learner typed, such as
 * the words of a search. `/notes?q=watt&lesson=a` is kept as `/notes?q=…&lesson=…`.
 */
export function withoutQueryValues(address: string): string {
  const mark = address.indexOf('?');
  if (mark === -1) {
    return address;
  }
  const names = [...new Set(new URLSearchParams(address.slice(mark + 1)).keys())];
  return names.length === 0 ? address.slice(0, mark) : `${address.slice(0, mark)}?${names.map((name) => `${encodeURIComponent(name)}=…`).join('&')}`;
}

/** The most events a recording holds; at this many it ends itself, so one left on for weeks cannot fill the disk. */
export const RECORDING_MAX_EVENTS = 20_000;
/** The most interface events taken in one request. */
export const EVENT_BATCH_MAX = 200;

const Moment = z.iso.datetime({ offset: true });
/** Where in the browser app the learner was, such as `/subjects/energi/lessons/watt`; a query keeps its names only (`withoutQueryValues`). */
const Page = z.string().min(1).max(2_000);
const text = (max: number) => z.string().max(max);

/** Something the learner did, or something that went wrong, in the browser. Strict, so nothing else is stored by accident. */
export const InterfaceEventSchema = z.discriminatedUnion('kind', [
  /** The learner came to a page. */
  z.strictObject({ kind: z.literal('navigate'), at: Moment, page: Page }),
  /** A click on something that acts: a link, a button, an option. Its name is what it says or is labelled, never a field's value. */
  z.strictObject({
    kind: z.literal('click'),
    at: Moment,
    page: Page,
    element: text(32),
    role: text(32).optional(),
    name: text(120).optional(),
  }),
  /** A key pressed. Inside a text field only Enter, Escape and Tab are recorded, so what is typed is never kept. */
  z.strictObject({
    kind: z.literal('key'),
    at: Moment,
    page: Page,
    key: text(32),
    modifiers: z.array(z.enum(['alt', 'ctrl', 'meta', 'shift'])).max(4),
    inField: z.boolean(),
  }),
  /** An error thrown in the browser app and not caught. */
  z.strictObject({
    kind: z.literal('error'),
    at: Moment,
    page: Page,
    message: text(2_000),
    source: text(500).optional(),
    line: z.number().int().min(0).optional(),
    column: z.number().int().min(0).optional(),
    stack: text(8_000).optional(),
  }),
  /** A promise rejected with nobody to handle it. */
  z.strictObject({ kind: z.literal('rejection'), at: Moment, page: Page, reason: text(2_000), stack: text(8_000).optional() }),
  /** The tab was hidden or shown again: a gap in the events is the learner away, not the app stuck. */
  z.strictObject({ kind: z.literal('visibility'), at: Moment, page: Page, state: z.enum(['visible', 'hidden']) }),
  /**
   * A read the browser app gave up on, which the server cannot see: no answer at all,
   * or an answer that does not match the contract.
   */
  z.strictObject({ kind: z.literal('fault'), at: Moment, page: Page, request: text(2_000), reason: z.enum(['network', 'contract']) }),
]);
export type InterfaceEvent = z.infer<typeof InterfaceEventSchema>;

/** What the browser sends to add its events to the recording under way. */
export const InterfaceEventBatchSchema = z.strictObject({
  events: z.array(InterfaceEventSchema).min(1).max(EVENT_BATCH_MAX),
});
export type InterfaceEventBatch = z.infer<typeof InterfaceEventBatchSchema>;

/** An API call the server answered while recording: from the browser app, the command-line tool or anything else. */
export const ApiCallSchema = z.object({
  kind: z.literal('call'),
  at: Moment,
  method: z.string(),
  /** The address called; a query keeps its names only (`withoutQueryValues`). */
  url: z.string(),
  status: z.number().int(),
  durationMs: z.number().int().min(0),
  /** For an answer of 400 or above, the problem it gave. */
  problem: z.object({ title: z.string(), detail: z.string().optional() }).optional(),
  /** For a call that failed inside the server, what was thrown, which the caller is not told. */
  error: z.string().optional(),
});
export type ApiCall = z.infer<typeof ApiCallSchema>;

/** One recorded event, numbered in the order it was stored; `source` says who saw it. */
export const RecordedEventSchema = z.union([
  z.object({ seq: z.number().int(), source: z.literal('interface'), event: InterfaceEventSchema }),
  z.object({ seq: z.number().int(), source: z.literal('api'), event: ApiCallSchema }),
]);
export type RecordedEvent = z.infer<typeof RecordedEventSchema>;

/** The browser the recording was made in, told when it starts; anything left out is unknown. */
export const RecordingClientSchema = z.strictObject({
  userAgent: text(500).optional(),
  viewport: z.strictObject({ width: z.number().int().min(0), height: z.number().int().min(0) }).optional(),
  interfaceLanguage: text(16).optional(),
});
export type RecordingClient = z.infer<typeof RecordingClientSchema>;

/** What starts a recording. */
export const StartRecordingSchema = z.strictObject({ client: RecordingClientSchema.optional() });
export type StartRecording = z.infer<typeof StartRecordingSchema>;

/** A recording: under way while `endedAt` is null. `endedBy` says whether the learner stopped it or it was full. */
export const RecordingSchema = z.object({
  id: z.number().int(),
  startedAt: Moment,
  endedAt: Moment.nullable(),
  endedBy: z.enum(['learner', 'full']).nullable(),
  events: z.number().int().min(0),
  client: RecordingClientSchema,
});
export type Recording = z.infer<typeof RecordingSchema>;

/** The recording under way, if any. At most one is. */
export const RecordingStateSchema = z.object({ recording: RecordingSchema.nullable() });
export type RecordingState = z.infer<typeof RecordingStateSchema>;

/** Every recording kept, the most recently started first. */
export const RecordingListSchema = z.object({ recordings: z.array(RecordingSchema) });
export type RecordingList = z.infer<typeof RecordingListSchema>;

/** What a batch of interface events came to: how many were kept, and whether the recording is still under way. */
export const EventsTakenSchema = z.object({ taken: z.number().int().min(0), recording: z.boolean() });
export type EventsTaken = z.infer<typeof EventsTakenSchema>;

/** A recording as one file: the format is named and versioned so a tool reading it can tell what it holds. */
export const SessionFileSchema = z.object({
  format: z.literal('skill-issue-session'),
  formatVersion: z.literal(1),
  appVersion: z.string(),
  exportedAt: Moment,
  recording: RecordingSchema,
  /** In the order they happened; events at the same moment in the order they were stored. */
  events: z.array(RecordedEventSchema),
});
export type SessionFile = z.infer<typeof SessionFileSchema>;
