import { SourceLibrarySchema, SourcePageSchema, type SourceLibrary, type SourcePage } from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';

const base = (subjectId: string): string => `/reader/subjects/${encodeURIComponent(subjectId)}/sources`;

export const fetchLibrary = async (subjectId: string, signal: AbortSignal): Promise<Fetched<SourceLibrary>> => getJson(base(subjectId), SourceLibrarySchema, signal);

export const fetchSource = async (subjectId: string, sourceId: string, signal: AbortSignal): Promise<Fetched<SourcePage>> =>
  getJson(`${base(subjectId)}/${encodeURIComponent(sourceId)}`, SourcePageSchema, signal);
