import { GlossarySchema, type Glossary } from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';

export const fetchGlossary = async (subjectId: string, language: string, signal: AbortSignal): Promise<Fetched<Glossary>> =>
  getJson(`/glossary/subjects/${encodeURIComponent(subjectId)}/terms?language=${encodeURIComponent(language)}`, GlossarySchema, signal);
