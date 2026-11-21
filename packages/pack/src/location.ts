import type { ContentFault, ItemKind } from '@skill-issue/contract';

/** The pack's array that holds each kind of item. */
export const COLLECTIONS = {
  subject: 'subject',
  sources: 'source',
  glossary: 'glossary-term',
  areas: 'area',
  lessons: 'lesson',
  questions: 'question',
  assets: 'asset',
} as const satisfies Record<string, ItemKind>;

export type Collection = keyof typeof COLLECTIONS;

export const isCollection = (key: unknown): key is Collection => typeof key === 'string' && Object.hasOwn(COLLECTIONS, key);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textAt = (value: unknown, key: string): string | undefined => {
  const field = isRecord(value) ? value[key] : undefined;
  return typeof field === 'string' ? field : undefined;
};

/**
 * What is needed to say which file an item lives in: the subject's default
 * language and the area each lesson is listed under. Read from content that
 * may not be valid, so every part is optional.
 */
export interface Layout {
  readonly defaultLanguage: string | undefined;
  readonly areaOfLesson: ReadonlyMap<string, string>;
}

export function layoutOf(pack: unknown): Layout {
  const subjects = isRecord(pack) && Array.isArray(pack['subject']) ? pack['subject'] : [];
  const firstSubject: unknown = subjects[0];
  const defaultLanguage = textAt(firstSubject, 'defaultLanguage');
  const areaOfLesson = new Map<string, string>();
  const areas: unknown = isRecord(pack) ? pack['areas'] : undefined;
  for (const area of Array.isArray(areas) ? areas : []) {
    const areaId = textAt(area, 'id');
    const language = textAt(area, 'language');
    const lessons: unknown = isRecord(area) ? area['lessons'] : undefined;
    if (areaId === undefined || (language !== undefined && language !== defaultLanguage) || !Array.isArray(lessons)) {
      continue;
    }
    for (const lesson of lessons) {
      if (typeof lesson === 'string' && !areaOfLesson.has(lesson)) {
        areaOfLesson.set(lesson, areaId);
      }
    }
  }
  return { defaultLanguage, areaOfLesson };
}

/** `.en` for a translation, nothing for the default language. */
export const languageSuffix = (language: string | undefined, layout: Layout): string =>
  language === undefined || language === layout.defaultLanguage ? '' : `.${language}`;

const UNLISTED = '(not listed in any area)';

/** The file an item lives in when the pack is written as a folder. */
export function fileOf(kind: ItemKind, item: unknown, layout: Layout): string {
  const id = textAt(item, 'id') ?? '(no id)';
  const suffix = languageSuffix(textAt(item, 'language'), layout);
  switch (kind) {
    case 'subject':
      return `subject${suffix}.yaml`;
    case 'source':
      return `sources/${id}${suffix}.md`;
    case 'glossary-term':
      return `glossary${suffix}.yaml`;
    case 'area':
      return `areas/${id}/area${suffix}.yaml`;
    case 'lesson':
      return `areas/${layout.areaOfLesson.get(id) ?? UNLISTED}/lessons/${id}/lesson${suffix}.md`;
    case 'question': {
      const lesson = textAt(item, 'lesson') ?? '(no lesson)';
      return `areas/${layout.areaOfLesson.get(lesson) ?? UNLISTED}/lessons/${lesson}/questions${suffix}.yaml`;
    }
    case 'asset':
      return textAt(item, 'path') ?? 'assets/';
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

/** `question kwh-eller-kw`, or null for an item without a usable id. */
export function itemLabel(kind: ItemKind, item: unknown): string | null {
  const id = kind === 'asset' ? textAt(item, 'path') : textAt(item, 'id');
  return id === undefined ? null : `${kind} ${id}`;
}

/** `steps[2].questions[0]` from `['steps', 2, 'questions', 0]`. */
export function fieldPath(path: readonly PropertyKey[]): string {
  let text = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      text += `[${segment}]`;
    } else {
      const name = String(segment);
      text += text === '' ? name : `.${name}`;
    }
  }
  return text;
}

/** A value as it appears in a fault: short, quoted where it is text, and "nothing" where it is absent. */
export function describeValue(value: unknown): string {
  if (value === undefined) {
    return 'nothing';
  }
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export const fault = (
  code: string,
  file: string,
  item: string | null,
  field: string,
  expected: string,
  found: string,
): ContentFault => ({ code, file, item, field, expected, found });

const faultKey = (f: ContentFault): string => [f.file, f.item ?? '', f.field, f.code].join('\u0000');

/** Faults in a stable order: by file, then item, then field, then code. */
export function sortFaults(faults: readonly ContentFault[]): ContentFault[] {
  return faults.toSorted((a, b) => {
    const left = faultKey(a);
    const right = faultKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
