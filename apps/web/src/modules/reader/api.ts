import { SourceLibrarySchema, SourcePageSchema, type SourceLibrary, type SourcePage } from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';

const base = (subjectId: string): string => `/reader/subjects/${encodeURIComponent(subjectId)}/sources`;

const inLanguage = (language: string): string => `?language=${encodeURIComponent(language)}`;

/** The subject's sources, each in `language` where translated. */
export const fetchLibrary = async (subjectId: string, language: string, signal: AbortSignal): Promise<Fetched<SourceLibrary>> =>
  getJson(`${base(subjectId)}${inLanguage(language)}`, SourceLibrarySchema, signal);

/** One source, in `language` where translated, with what rests on it. */
export const fetchSource = async (subjectId: string, sourceId: string, language: string, signal: AbortSignal): Promise<Fetched<SourcePage>> =>
  getJson(`${base(subjectId)}/${encodeURIComponent(sourceId)}${inLanguage(language)}`, SourcePageSchema, signal);
