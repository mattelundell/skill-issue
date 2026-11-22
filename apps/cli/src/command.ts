import { parseArgs } from 'node:util';
import type { ExamScope } from '@skill-issue/contract';

export const DEFAULT_URL = 'http://127.0.0.1:4747';

/** The languages the notes file can write its own headings in. */
const HEADING_LANGUAGES = ['en', 'sv'] as const;
type HeadingLanguage = (typeof HEADING_LANGUAGES)[number];
const isHeadingLanguage = (language: string): language is HeadingLanguage => HEADING_LANGUAGES.some((known) => known === language);

export type Command =
  | { readonly kind: 'status'; readonly url: string }
  | { readonly kind: 'validate'; readonly path: string }
  | { readonly kind: 'load'; readonly path: string; readonly url: string; readonly yes: boolean }
  | { readonly kind: 'export'; readonly subject: string; readonly target: string; readonly url: string }
  | { readonly kind: 'backup'; readonly target: string; readonly url: string }
  | { readonly kind: 'restore'; readonly path: string; readonly url: string; readonly dryRun: boolean }
  | {
      readonly kind: 'export-notes';
      readonly subject: string;
      readonly target: string;
      readonly url: string;
      readonly language: string | undefined;
      readonly interfaceLanguage: HeadingLanguage;
    }
  | { readonly kind: 'review'; readonly subject: string | undefined; readonly url: string }
  | { readonly kind: 'exam'; readonly subject: string; readonly scope: ExamScope; readonly url: string; readonly language: string | undefined }
  | { readonly kind: 'help' }
  | { readonly kind: 'invalid'; readonly message: string };

export const USAGE = `Usage: skill-issue <command> [options]

Commands:
  status                          Show whether the application is up and what is due in each subject
  review [subject]                Answer the questions due today, in every subject or in one
  exam <subject> <lesson|area> <id>
                                  Sit a lesson or area exam; nothing is graded until you hand in
  validate <pack>                 Check a pack folder or .zip without loading it
  load <pack>                     Load a pack folder or .zip; shows what changes first
  export <subject> <target>       Write a subject as a pack: a new folder, or a file ending in .zip
  export-notes <subject> <file>   Write a subject's notes as one Markdown file, filed by area, lesson and step
  backup <file>                   Write everything — subjects, answers, notes, where each lesson was left — to one file
  restore <file>                  Restore a backup into an empty installation of the same version

Options:
  --url <url>          Where the application listens (default ${DEFAULT_URL})
  --yes                With load: store an update to an existing subject without asking again
  --dry-run            With restore: check the backup against the installation and write nothing
  --language <code>    With export-notes and exam: the language the subject is given in (default: the subject's own)
  --interface <en|sv>  With export-notes: the language of the file's own headings (default en)
  --help               Show this text
`;

/** How many positional arguments each command takes after its name, and what to say when they are missing. */
const ARGUMENTS = {
  status: { min: 0, max: 0, needs: '' },
  review: { min: 0, max: 1, needs: '' },
  exam: { min: 3, max: 3, needs: 'a subject id, lesson or area, and its id' },
  validate: { min: 1, max: 1, needs: 'a pack folder or .zip' },
  load: { min: 1, max: 1, needs: 'a pack folder or .zip' },
  export: { min: 2, max: 2, needs: 'a subject id and a target' },
  'export-notes': { min: 2, max: 2, needs: 'a subject id and a file to write' },
  backup: { min: 1, max: 1, needs: 'a file to write' },
  restore: { min: 1, max: 1, needs: 'a backup file' },
} as const;

const isCommandName = (name: string): name is keyof typeof ARGUMENTS => Object.hasOwn(ARGUMENTS, name);

/** Turns the arguments after the program name into a command, never throwing for bad input. */
export function parseCommand(argv: readonly string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        url: { type: 'string' },
        help: { type: 'boolean' },
        yes: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        language: { type: 'string' },
        interface: { type: 'string' },
      },
      allowPositionals: true,
    });
  } catch (thrown) {
    return { kind: 'invalid', message: thrown instanceof Error ? thrown.message : String(thrown) };
  }
  const { values } = parsed;

  if (values.help === true) {
    return { kind: 'help' };
  }
  const [name, ...rest] = parsed.positionals;
  if (name === undefined) {
    return { kind: 'help' };
  }
  if (!isCommandName(name)) {
    return { kind: 'invalid', message: `Unknown command "${name}"` };
  }
  const { min, max, needs } = ARGUMENTS[name];
  if (rest.length > max) {
    return { kind: 'invalid', message: `Unexpected argument "${rest[max]}"` };
  }
  if (rest.length < min) {
    return { kind: 'invalid', message: `"${name}" needs ${needs}` };
  }
  // Each option and the one command it belongs to.
  const owned: readonly (readonly [string, unknown, readonly string[]])[] = [
    ['yes', values.yes, ['load']],
    ['dry-run', values['dry-run'], ['restore']],
    ['language', values.language, ['export-notes', 'exam']],
    ['interface', values.interface, ['export-notes']],
  ];
  for (const [option, value, owners] of owned) {
    if (value !== undefined && !owners.includes(name)) {
      return { kind: 'invalid', message: `--${option} applies only to ${owners.join(' and ')}` };
    }
  }

  const url = values.url ?? DEFAULT_URL;
  if (!URL.canParse(url)) {
    return { kind: 'invalid', message: `"${url}" is not a URL` };
  }
  const [first = '', second = ''] = rest;
  switch (name) {
    case 'status':
      return { kind: 'status', url };
    case 'review':
      return { kind: 'review', subject: rest[0], url };
    case 'exam': {
      const [, kind = '', id = ''] = rest;
      if (kind !== 'lesson' && kind !== 'area') {
        return { kind: 'invalid', message: `"exam" covers a lesson or an area, not "${kind}"` };
      }
      return { kind: 'exam', subject: first, scope: { kind, id }, url, language: values.language };
    }
    case 'validate':
      return { kind: 'validate', path: first };
    case 'load':
      return { kind: 'load', path: first, url, yes: values.yes === true };
    case 'export':
      return { kind: 'export', subject: first, target: second, url };
    case 'backup':
      return { kind: 'backup', target: first, url };
    case 'restore':
      return { kind: 'restore', path: first, url, dryRun: values['dry-run'] === true };
    case 'export-notes': {
      const interfaceLanguage = values.interface ?? 'en';
      if (!isHeadingLanguage(interfaceLanguage)) {
        return { kind: 'invalid', message: `--interface must be ${HEADING_LANGUAGES.join(' or ')}` };
      }
      return { kind: 'export-notes', subject: first, target: second, url, language: values.language, interfaceLanguage };
    }
    default: {
      const unhandled: never = name;
      return unhandled;
    }
  }
}
