import type { Lesson, Pack, Question, Source, Step } from '@skill-issue/contract';
import { stringify } from 'yaml';
import type { PackFiles } from './decode.js';
import { fileOf, layoutOf } from './location.js';

const utf8 = new TextEncoder();

/** YAML without line folding, so a long line comes back exactly as it went out. */
const yaml = (value: unknown): string => stringify(value, { lineWidth: 0 });

const withoutLanguage = <T extends { readonly language: string }>({ language: _language, ...rest }: T): Omit<T, 'language'> => rest;

const frontMatter = (fields: unknown, body: string): string => `---\n${yaml(fields)}---\n\n${body}\n`;

function stepText(step: Step): string {
  switch (step.type) {
    case 'text':
    case 'example':
      return `---step---\ntype: ${step.type}\n\n${step.body}\n`;
    case 'check':
      return `---step---\n${yaml({ type: step.type, questions: step.questions })}`;
    default: {
      const unhandled: never = step;
      throw new Error(`Unhandled step ${JSON.stringify(unhandled)}`);
    }
  }
}

function lessonText(lesson: Lesson): string {
  const { steps, ...fields } = withoutLanguage(lesson);
  return frontMatter(fields, steps.map(stepText).join('\n'));
}

function sourceText(source: Source): string {
  const { body, ...fields } = withoutLanguage(source);
  return frontMatter(fields, body);
}

/** Writes a valid pack as the files of a pack folder. Decoding them gives the same pack back. */
export function encodePack(pack: Pack): PackFiles {
  const layout = layoutOf(pack);
  const files = new Map<string, Uint8Array>();
  const put = (path: string, text: string): void => {
    files.set(path, utf8.encode(text));
  };

  for (const subject of pack.subject) {
    const fields = withoutLanguage(subject);
    const isOriginal = subject.language === subject.defaultLanguage;
    put(fileOf('subject', subject, layout), yaml(isOriginal ? { formatVersion: pack.formatVersion, ...fields } : fields));
  }
  for (const source of pack.sources) {
    put(fileOf('source', source, layout), sourceText(source));
  }
  for (const area of pack.areas) {
    put(fileOf('area', area, layout), yaml(withoutLanguage(area)));
  }
  for (const lesson of pack.lessons) {
    put(fileOf('lesson', lesson, layout), lessonText(lesson));
  }

  // Glossaries and question banks hold several items per file, in pack order.
  const grouped = new Map<string, unknown[]>();
  const group = (path: string, item: unknown): void => {
    grouped.set(path, [...(grouped.get(path) ?? []), item]);
  };
  for (const term of pack.glossary) {
    group(fileOf('glossary-term', term, layout), withoutLanguage(term));
  }
  for (const question of pack.questions) {
    const { lesson: _lesson, ...fields }: Question = question;
    group(fileOf('question', question, layout), withoutLanguage(fields));
  }
  for (const [path, items] of grouped) {
    put(path, yaml(items));
  }

  for (const asset of pack.assets) {
    files.set(asset.path, Buffer.from(asset.data, 'base64'));
  }
  return files;
}
