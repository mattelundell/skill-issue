import { API_PREFIX, NoteListSchema, NoteSchema, type Note, type NoteList } from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';

const subjectBase = (subjectId: string): string => `/notes/subjects/${encodeURIComponent(subjectId)}`;

/** A subject's notes: one lesson's in step order, or all of them the most recently written first, kept to those matching `query`. */
export async function fetchNotes(subjectId: string, filter: { readonly lessonId?: string; readonly query?: string }, signal: AbortSignal): Promise<Fetched<NoteList>> {
  const search = new URLSearchParams();
  if (filter.lessonId !== undefined) {
    search.set('lesson', filter.lessonId);
  }
  if (filter.query !== undefined && filter.query.trim() !== '') {
    search.set('q', filter.query.trim());
  }
  const query = search.size === 0 ? '' : `?${search.toString()}`;
  return getJson(`${subjectBase(subjectId)}/notes${query}`, NoteListSchema, signal);
}

/** Where a subject's notes are fetched as one Markdown file: titles in the content language, the file's own headings in the interface language. */
export function notesFileUrl(subjectId: string, contentLanguage: string, interfaceLanguage: string): string {
  const search = new URLSearchParams({ language: contentLanguage, interface: interfaceLanguage });
  return `${API_PREFIX}${subjectBase(subjectId)}/notes.md?${search.toString()}`;
}

/** What writing a note came to: kept as the server now holds it, removed because it was emptied, or not reached. */
export type Written = { readonly kind: 'saved'; readonly note: Note } | { readonly kind: 'removed' } | { readonly kind: 'failed' };

export async function writeNote(subjectId: string, lessonId: string, step: number, body: string): Promise<Written> {
  try {
    const response = await fetch(`${API_PREFIX}${subjectBase(subjectId)}/lessons/${encodeURIComponent(lessonId)}/steps/${step}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (response.status === 204) {
      return { kind: 'removed' };
    }
    if (!response.ok) {
      return { kind: 'failed' };
    }
    const note = NoteSchema.safeParse(await response.json());
    return note.success ? { kind: 'saved', note: note.data } : { kind: 'failed' };
  } catch {
    // No connection: the text stays in the pane, and the next change tries again.
    return { kind: 'failed' };
  }
}
