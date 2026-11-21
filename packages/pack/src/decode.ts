import { ASSET_MEDIA_TYPES, type ContentFault } from '@skill-issue/contract';
import { parseDocument } from 'yaml';
import { describeValue, fault } from './location.js';

/** A pack as files: the path from the pack's root, with `/` between folders, to the file's bytes. */
export type PackFiles = ReadonlyMap<string, Uint8Array>;

/** The contents of a pack's files as one unvalidated pack, and what was wrong with the files themselves. */
export interface Decoded {
  readonly pack: Record<string, unknown>;
  readonly faults: readonly ContentFault[];
  /**
   * False when a file could not be read at all. Its items are then missing
   * from the pack, and checking the rest would report every reference to them.
   */
  readonly readable: boolean;
}

const STEP_SEPARATOR = '---step---';
const LANGUAGE = '[a-z]{2,3}(?:-[A-Z]{2})?';
const ID = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** The shapes a file in a pack may have; anything else is reported. */
const PATTERNS = {
  subject: new RegExp(`^subject(?:\\.(${LANGUAGE}))?\\.yaml$`),
  glossary: new RegExp(`^glossary(?:\\.(${LANGUAGE}))?\\.yaml$`),
  source: new RegExp(`^sources/(${ID})(?:\\.(${LANGUAGE}))?\\.md$`),
  asset: /^assets\/[^/]+$/,
  area: new RegExp(`^areas/(${ID})/area(?:\\.(${LANGUAGE}))?\\.yaml$`),
  lesson: new RegExp(`^areas/(${ID})/lessons/(${ID})/lesson(?:\\.(${LANGUAGE}))?\\.md$`),
  questions: new RegExp(`^areas/(${ID})/lessons/(${ID})/questions(?:\\.(${LANGUAGE}))?\\.yaml$`),
};

/** Files a pack folder may hold for people that are not part of the subject. */
const IGNORED = /^(?:README(?:\.[A-Za-z]+)?|LICEN[CS]E(?:\.[A-Za-z]+)?)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const utf8 = new TextDecoder('utf-8', { fatal: true });

class Decoder {
  private readonly faults: ContentFault[] = [];
  private defaultLanguage = '';
  private readable = true;

  constructor(private readonly files: PackFiles) {}

  decode(): Decoded {
    const pack: Record<string, unknown> = { subject: [], sources: [], glossary: [], areas: [], lessons: [], questions: [], assets: [] };
    const push = (collection: string, item: unknown): void => {
      const list = pack[collection];
      if (Array.isArray(list)) {
        list.push(item);
      }
    };

    const subjectFile = this.files.get('subject.yaml');
    if (subjectFile === undefined) {
      this.faults.push(fault('missing-file', 'subject.yaml', null, '', 'a subject.yaml at the root of the pack', 'no such file'));
      return { pack, faults: this.faults, readable: false };
    }
    const subject = this.yaml('subject.yaml', subjectFile);
    if (isRecord(subject)) {
      if (typeof subject['defaultLanguage'] === 'string') {
        this.defaultLanguage = subject['defaultLanguage'];
      }
      pack['formatVersion'] = subject['formatVersion'];
    }

    for (const [path, bytes] of [...this.files].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (IGNORED.test(path)) {
        continue;
      }
      let match: RegExpExecArray | null;
      if ((match = PATTERNS.subject.exec(path)) !== null) {
        const entry = path === 'subject.yaml' ? subject : this.yaml(path, bytes);
        const fields = this.mapping(path, entry);
        if (fields !== undefined) {
          const { formatVersion, ...rest } = fields;
          if (path !== 'subject.yaml' && formatVersion !== undefined && formatVersion !== pack['formatVersion']) {
            this.faults.push(fault('translation-mismatch', path, null, 'formatVersion', describeValue(pack['formatVersion']), describeValue(formatVersion)));
          }
          push('subject', this.tagged(path, rest, match[1]));
        }
      } else if ((match = PATTERNS.glossary.exec(path)) !== null) {
        for (const term of this.list(path, this.yaml(path, bytes))) {
          push('glossary', this.tagged(path, term, match[1]));
        }
      } else if ((match = PATTERNS.source.exec(path)) !== null) {
        const document = this.frontMatter(path, bytes);
        if (document !== undefined) {
          const source = this.tagged(path, { ...document.fields, body: document.body }, match[2]);
          this.sameId(path, source, match[1] ?? '', 'the file name');
          push('sources', source);
        }
      } else if (PATTERNS.asset.test(path)) {
        const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        const mediaType = new Map<string, string>(Object.entries(ASSET_MEDIA_TYPES)).get(extension) ?? 'application/octet-stream';
        push('assets', { path, mediaType, data: Buffer.from(bytes).toString('base64') });
      } else if ((match = PATTERNS.area.exec(path)) !== null) {
        const area = this.mapping(path, this.yaml(path, bytes));
        if (area !== undefined) {
          const tagged = this.tagged(path, area, match[2]);
          this.sameId(path, tagged, match[1] ?? '', 'the folder name');
          push('areas', tagged);
        }
      } else if ((match = PATTERNS.lesson.exec(path)) !== null) {
        const lesson = this.lesson(path, bytes, match[3]);
        if (lesson !== undefined) {
          this.sameId(path, lesson, match[2] ?? '', 'the folder name');
          this.listedInFolderArea(path, match[1] ?? '', match[2] ?? '');
          push('lessons', lesson);
        }
      } else if ((match = PATTERNS.questions.exec(path)) !== null) {
        const lesson = match[2] ?? '';
        for (const question of this.list(path, this.yaml(path, bytes))) {
          if ('lesson' in question) {
            this.faults.push(fault('derived-field', path, null, 'lesson', 'no "lesson" field: a question belongs to the lesson whose folder it is in', describeValue(question['lesson'])));
          }
          push('questions', { ...this.tagged(path, question, match[3]), lesson });
        }
      } else {
        this.faults.push(fault('unexpected-file', path, null, '', 'a file the pack format describes, at the place it describes', describeValue(path)));
      }
    }
    return { pack, faults: this.faults, readable: this.readable };
  }

  /** A lesson folder sits under the area that lists the lesson. */
  private listedInFolderArea(path: string, area: string, lesson: string): void {
    const areaFile = this.files.get(`areas/${area}/area.yaml`);
    if (areaFile === undefined) {
      return;
    }
    const parsed: unknown = parseDocument(this.text(path, areaFile) ?? '').toJS();
    const lessons = isRecord(parsed) ? parsed['lessons'] : undefined;
    if (Array.isArray(lessons) && !lessons.includes(lesson)) {
      this.faults.push(fault('lesson-misfiled', path, `lesson ${lesson}`, '', `a lesson folder under the area whose area.yaml lists it; areas/${area}/area.yaml does not`, describeValue(path)));
    }
  }

  /** Adds the language the file name says; a file may not state its own. */
  private tagged(path: string, fields: Record<string, unknown>, suffix: string | undefined): Record<string, unknown> {
    if ('language' in fields) {
      this.faults.push(fault('derived-field', path, null, 'language', 'no "language" field: the language is the file name suffix, or the default language without one', describeValue(fields['language'])));
    }
    return { ...fields, language: suffix ?? this.defaultLanguage };
  }

  private sameId(path: string, item: Record<string, unknown>, expected: string, from: string): void {
    if (item['id'] !== expected) {
      this.faults.push(fault('id-mismatch', path, null, 'id', `${describeValue(expected)}, the same as ${from}`, describeValue(item['id'])));
    }
  }

  private text(path: string, bytes: Uint8Array): string | undefined {
    try {
      return utf8.decode(bytes).replaceAll('\r\n', '\n');
    } catch {
      // Not propagated: the fault says what to fix.
      this.readable = false;
      this.faults.push(fault('not-utf8', path, null, '', 'text encoded as UTF-8', 'bytes that are not UTF-8'));
      return undefined;
    }
  }

  private yaml(path: string, bytes: Uint8Array, offset = 0): unknown {
    const text = this.text(path, bytes);
    return text === undefined ? undefined : this.parseYaml(path, text, offset);
  }

  /** YAML 1.2 core schema: no custom tags, no merge keys, duplicate keys refused, aliases bounded. */
  private parseYaml(path: string, text: string, lineOffset: number): unknown {
    const document = parseDocument(text, { schema: 'core', merge: false, uniqueKeys: true, prettyErrors: true });
    const [first] = document.errors;
    if (first !== undefined) {
      this.readable = false;
      const line = (first.linePos?.[0].line ?? 0) + lineOffset;
      this.faults.push(fault('invalid-yaml', path, null, `line ${line}`, 'valid YAML', first.message.split('\n')[0] ?? first.code));
      return undefined;
    }
    return document.toJS({ maxAliasCount: 50 });
  }

  private mapping(path: string, value: unknown): Record<string, unknown> | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (!isRecord(value)) {
      this.faults.push(fault('schema', path, null, '', 'a mapping of field names to values', describeValue(value)));
      return undefined;
    }
    return value;
  }

  private list(path: string, value: unknown): Record<string, unknown>[] {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      this.faults.push(fault('schema', path, null, '', 'a list of entries', describeValue(value)));
      return [];
    }
    return value.flatMap((entry, index) => {
      if (isRecord(entry)) {
        return [entry];
      }
      this.faults.push(fault('schema', path, null, `[${index}]`, 'a mapping of field names to values', describeValue(entry)));
      return [];
    });
  }

  /** A Markdown file that begins with YAML front matter between two `---` lines. */
  private frontMatter(path: string, bytes: Uint8Array): { fields: Record<string, unknown>; body: string } | undefined {
    const text = this.text(path, bytes);
    if (text === undefined) {
      return undefined;
    }
    const lines = text.split('\n');
    const end = lines.indexOf('---', 1);
    if (lines[0] !== '---' || end === -1) {
      this.readable = false;
      this.faults.push(fault('invalid-front-matter', path, null, 'line 1', 'front matter: a line "---", YAML fields, and a closing line "---"', describeValue(lines[0])));
      return undefined;
    }
    const fields = this.mapping(path, this.parseYaml(path, lines.slice(1, end).join('\n'), 1));
    return fields === undefined ? undefined : { fields, body: lines.slice(end + 1).join('\n').trim() };
  }

  /** Front matter, then steps, each opened by a line `---step---`, a YAML header and a blank line before its body. */
  private lesson(path: string, bytes: Uint8Array, suffix: string | undefined): Record<string, unknown> | undefined {
    const document = this.frontMatter(path, bytes);
    if (document === undefined) {
      return undefined;
    }
    const chunks = document.body.split('\n').reduce<string[][]>(
      (all, line) => {
        if (line.trimEnd() === STEP_SEPARATOR) {
          all.push([]);
        } else {
          all.at(-1)?.push(line);
        }
        return all;
      },
      [[]],
    );
    const [preamble = [], ...stepChunks] = chunks;
    if (preamble.join('').trim() !== '') {
      this.faults.push(fault('text-outside-step', path, null, 'steps', `every line after the front matter inside a step opened by "${STEP_SEPARATOR}"`, describeValue(preamble.join('\n').trim())));
    }
    const steps = stepChunks.map((chunk, index) => {
      const lines = chunk.join('\n').trim().split('\n');
      const blank = lines.findIndex((line) => line.trim() === '');
      const header = blank === -1 ? lines : lines.slice(0, blank);
      const body = blank === -1 ? '' : lines.slice(blank + 1).join('\n').trim();
      const fields: unknown = this.parseYaml(path, header.join('\n'), 0);
      if (!isRecord(fields)) {
        this.faults.push(fault('invalid-step', path, null, `steps[${index}]`, 'a header such as "type: text" on the line after the separator', describeValue(header.join('\n'))));
        return {};
      }
      return body === '' ? fields : { ...fields, body };
    });
    return this.tagged(path, { ...document.fields, steps }, suffix);
  }
}

/** Reads a pack's files into one unvalidated pack. The schema and the rules check the result. */
export function decodePack(files: PackFiles): Decoded {
  return new Decoder(files).decode();
}
