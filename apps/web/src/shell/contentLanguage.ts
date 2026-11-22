/**
 * The language each subject is read in, chosen on its home and kept on this
 * device, as the interface language is. It is a choice per subject, since
 * one learner may read one subject in English and another in Swedish; the
 * server falls back to a subject's default language for anything not
 * translated, so a remembered language the subject no longer offers is harmless.
 */

const STORAGE_KEY = 'skill-issue.content-language';

function readAll(): Readonly<Record<string, string>> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
      return {};
    }
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    // Storage blocked or unreadable: every subject in its default language.
    return {};
  }
}

/** The language the learner chose for a subject, or undefined for its default. */
export function contentLanguageOf(subjectId: string): string | undefined {
  return readAll()[subjectId];
}

/** Remembers the language a subject is read in. */
export function chooseContentLanguage(subjectId: string, language: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [subjectId]: language }));
  } catch {
    // Storage blocked: the choice holds until the page is left.
  }
}
