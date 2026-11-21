import type { ContentFault } from '@skill-issue/contract';
import type { z } from 'zod';
import { COLLECTIONS, describeValue, fault, fieldPath, fileOf, isCollection, itemLabel, layoutOf } from './location.js';

type Issue = z.core.$ZodIssue;

const quoteAll = (values: readonly unknown[]): string => values.map((value) => JSON.stringify(value)).join(', ');

const FORMATS: Readonly<Record<string, string>> = {
  url: 'an http or https URL',
  date: 'a date written YYYY-MM-DD',
  base64: 'base64-encoded data',
};

function bound(kind: 'at least' | 'at most', origin: string, limit: number | bigint, inclusive: boolean): string {
  if (origin === 'array') {
    return `${kind} ${limit} ${limit === 1 ? 'entry' : 'entries'}`;
  }
  if (origin === 'string') {
    return kind === 'at least' && limit === 1 ? 'text that is not empty' : `text of ${kind} ${limit} characters`;
  }
  if (inclusive) {
    return `a number ${kind} ${limit}`;
  }
  return `a number ${kind === 'at least' ? 'greater' : 'less'} than ${limit}`;
}

/** What the schema wanted, in words an author can act on. */
function expectedBy(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.expected === 'int' ? 'a whole number' : `a value of type ${issue.expected}`;
    case 'invalid_value':
      return issue.values.length === 1 ? quoteAll(issue.values) : `one of ${quoteAll(issue.values)}`;
    case 'invalid_format':
      return FORMATS[issue.format] ?? issue.message;
    case 'too_small':
      return bound('at least', issue.origin, issue.minimum, issue.inclusive ?? true);
    case 'too_big':
      return bound('at most', issue.origin, issue.maximum, issue.inclusive ?? true);
    case 'unrecognized_keys':
      return 'no field of this name';
    case 'invalid_union':
      return 'options' in issue && Array.isArray(issue.options) ? `one of ${quoteAll(issue.options)}` : issue.message;
    case 'not_multiple_of':
    case 'invalid_key':
    case 'invalid_element':
    case 'custom':
      return issue.message;
    default: {
      const unhandled: never = issue;
      return JSON.stringify(unhandled);
    }
  }
}

const isIndexable = (value: unknown): value is Readonly<Record<PropertyKey, unknown>> =>
  typeof value === 'object' && value !== null;

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let value = root;
  for (const segment of path) {
    if (!isIndexable(value)) {
      return undefined;
    }
    value = value[segment];
  }
  return value;
}

/** File and item a path into the pack points at; top-level fields belong to the subject file. */
function locate(pack: unknown, path: readonly PropertyKey[]): { file: string; item: string | null; within: readonly PropertyKey[] } {
  const [collection, index, ...within] = path;
  const layout = layoutOf(pack);
  if (isCollection(collection) && typeof index === 'number') {
    const kind = COLLECTIONS[collection];
    const item = valueAt(pack, [collection, index]);
    return { file: fileOf(kind, item, layout), item: itemLabel(kind, item), within };
  }
  if (collection === 'formatVersion' || collection === 'subject') {
    return { file: 'subject.yaml', item: null, within: path };
  }
  return { file: `${String(collection)}/`, item: null, within: path };
}

/** Every schema violation in a submitted pack, each pointing at its file, item and field. */
export function schemaFaults(pack: unknown, error: z.ZodError): ContentFault[] {
  return error.issues.flatMap((issue): ContentFault[] => {
    const { file, item, within } = locate(pack, issue.path);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) =>
        fault('unknown-field', file, item, fieldPath([...within, key]), expectedBy(issue), describeValue(valueAt(pack, [...issue.path, key]))),
      );
    }
    const found = describeValue(valueAt(pack, issue.path));
    return [fault('schema', file, item, fieldPath(within), expectedBy(issue), found)];
  });
}
