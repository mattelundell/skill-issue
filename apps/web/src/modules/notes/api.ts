import {
  API_PREFIX,
  NOTE_IMAGE_MAX_BYTES,
  NotebookSchema,
  NotebookSectionSchema,
  NotebookSummaryListSchema,
  NoteImageSchema,
  NoteImageTypeSchema,
  type Notebook,
  type NotebookSection,
  type NotebookSummaryList,
  type SectionKind,
} from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';

const subjectBase = (subjectId: string): string => `/notes/subjects/${encodeURIComponent(subjectId)}`;

/** A subject's written sections, the most recently written first; with a query, those holding every word of it. */
export async function fetchNotebook(subjectId: string, query: string, signal: AbortSignal): Promise<Fetched<Notebook>> {
  const q = query.trim() === '' ? '' : `?${new URLSearchParams({ q: query.trim() }).toString()}`;
  return getJson(`${subjectBase(subjectId)}/notebook${q}`, NotebookSchema, signal);
}

/** Every subject's notebook in brief. */
export async function fetchNotebooks(signal: AbortSignal): Promise<Fetched<NotebookSummaryList>> {
  return getJson('/notes/notebooks', NotebookSummaryListSchema, signal);
}

/** Where a subject's notebook is fetched as a zip: titles in the content language, the files' own headings in the interface language. */
export function notebookZipUrl(subjectId: string, contentLanguage: string, interfaceLanguage: string): string {
  const search = new URLSearchParams({ language: contentLanguage, interface: interfaceLanguage });
  return `${API_PREFIX}${subjectBase(subjectId)}/notebook.zip?${search.toString()}`;
}

/** Where one of a notebook's images is served. */
export const imageUrl = (subjectId: string, name: string): string => `${API_PREFIX}${subjectBase(subjectId)}/notebook/images/${encodeURIComponent(name)}`;

/** An image link as a note writes it: only the notebook's own images, named as the server names them. */
const NOTE_IMAGE = /^bilder\/(bild-[1-9][0-9]{0,5}\.(?:png|jpg|gif|webp))$/;

/** Where an image a note links to comes from; undefined for anything that is not one of the notebook's own. */
export const noteImageSource =
  (subjectId: string) =>
  (src: string): string | undefined => {
    const name = NOTE_IMAGE.exec(src)?.[1];
    return name === undefined ? undefined : imageUrl(subjectId, name);
  };

/** What writing a section came to: kept as the server now holds it, removed because it was emptied, or not reached. */
export type Written = { readonly kind: 'saved'; readonly section: NotebookSection } | { readonly kind: 'removed' } | { readonly kind: 'failed' };

export async function writeSection(subjectId: string, kind: SectionKind, itemId: string, body: string): Promise<Written> {
  try {
    const response = await fetch(`${API_PREFIX}${subjectBase(subjectId)}/notebook/${kind === 'area' ? 'areas' : 'lessons'}/${encodeURIComponent(itemId)}`, {
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
    const section = NotebookSectionSchema.safeParse(await response.json());
    return section.success ? { kind: 'saved', section: section.data } : { kind: 'failed' };
  } catch {
    // No connection: the text stays where it was typed, and the next change tries again.
    return { kind: 'failed' };
  }
}

/** What adding an image came to: its name to link it by, or why not. */
export type Added = { readonly kind: 'added'; readonly name: string } | { readonly kind: 'refused'; readonly reason: 'type' | 'size' | 'failed' };

function asBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/** Sends an image the learner pasted or chose, as JSON, since every write is. */
export async function addImage(subjectId: string, file: Blob): Promise<Added> {
  const type = NoteImageTypeSchema.safeParse(file.type);
  if (!type.success) {
    return { kind: 'refused', reason: 'type' };
  }
  if (file.size > NOTE_IMAGE_MAX_BYTES) {
    return { kind: 'refused', reason: 'size' };
  }
  try {
    const data = asBase64(new Uint8Array(await file.arrayBuffer()));
    const response = await fetch(`${API_PREFIX}${subjectBase(subjectId)}/notebook/images`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ mediaType: type.data, data }),
    });
    if (response.status === 413) {
      return { kind: 'refused', reason: 'size' };
    }
    const image = response.status === 201 ? NoteImageSchema.safeParse(await response.json()) : undefined;
    return image?.success === true ? { kind: 'added', name: image.data.name } : { kind: 'refused', reason: 'failed' };
  } catch {
    return { kind: 'refused', reason: 'failed' };
  }
}
