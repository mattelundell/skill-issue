import {
  API_PREFIX,
  RecordingListSchema,
  RecordingSchema,
  RecordingStateSchema,
  type InterfaceEvent,
  type Recording,
  type RecordingClient,
  type RecordingList,
  type RecordingState,
} from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';
import type { Sent } from './recorder.js';

const BASE = '/diagnostics';

export const fetchRecordingState = async (signal: AbortSignal): Promise<Fetched<RecordingState>> => getJson(`${BASE}/recording`, RecordingStateSchema, signal);

export const fetchRecordings = async (signal: AbortSignal): Promise<Fetched<RecordingList>> => getJson(`${BASE}/recordings`, RecordingListSchema, signal);

/** Where a recording is fetched as one file. */
export const recordingFileUrl = (id: number): string => `${API_PREFIX}${BASE}/recordings/${id}/export`;

async function post(path: string, body: unknown): Promise<Response | undefined> {
  try {
    return await fetch(`${API_PREFIX}${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // No connection.
    return undefined;
  }
}

async function recordingFrom(response: Response | undefined): Promise<Recording | undefined> {
  if (response === undefined || !response.ok) {
    return undefined;
  }
  const parsed = RecordingSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? parsed.data : undefined;
}

/** Starts recording; the one under way when one already is. Undefined when the server could not be reached. */
export const startRecording = async (client: RecordingClient): Promise<Recording | undefined> => recordingFrom(await post('/recordings', { client }));

/** Ends a recording. Undefined when the server could not be reached. */
export const endRecording = async (id: number): Promise<Recording | undefined> => recordingFrom(await post(`/recordings/${id}/end`, {}));

/** Removes a recording. False when it could not be. */
export async function removeRecording(id: number): Promise<boolean> {
  try {
    const response = await fetch(`${API_PREFIX}${BASE}/recordings/${id}`, { method: 'DELETE' });
    return response.status === 204 || response.status === 404;
  } catch {
    return false;
  }
}

/** Adds events to a recording, saying what became of them. */
export async function sendEvents(id: number, events: readonly InterfaceEvent[]): Promise<Sent> {
  const response = await post(`/recordings/${id}/events`, { events });
  if (response === undefined || response.status >= 500) {
    return 'unreachable';
  }
  if (response.status === 404 || response.status === 409) {
    return 'ended';
  }
  if (!response.ok) {
    return 'refused';
  }
  const taken: unknown = await response.json().catch(() => undefined);
  return typeof taken === 'object' && taken !== null && 'recording' in taken && taken.recording === false ? 'ended' : 'kept';
}

/** Adds events as the page goes away: a beacon outlives the page, and says JSON, as every write must. */
export function sendEventsAtExit(id: number, events: readonly InterfaceEvent[]): void {
  navigator.sendBeacon(`${API_PREFIX}${BASE}/recordings/${id}/events`, new Blob([JSON.stringify({ events })], { type: 'application/json' }));
}
