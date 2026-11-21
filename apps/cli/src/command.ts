import { parseArgs } from 'node:util';

export const DEFAULT_URL = 'http://127.0.0.1:4747';

export type Command =
  | { readonly kind: 'status'; readonly url: string }
  | { readonly kind: 'validate'; readonly path: string }
  | { readonly kind: 'load'; readonly path: string; readonly url: string; readonly yes: boolean }
  | { readonly kind: 'export'; readonly subject: string; readonly target: string; readonly url: string }
  | { readonly kind: 'help' }
  | { readonly kind: 'invalid'; readonly message: string };

export const USAGE = `Usage: skill-issue <command> [options]

Commands:
  status                     Show whether the application is up and which modules it runs
  validate <pack>            Check a pack folder or .zip without loading it
  load <pack>                Load a pack folder or .zip; shows what changes first
  export <subject> <target>  Write a subject as a pack: a new folder, or a file ending in .zip

Options:
  --url <url>   Where the application listens (default ${DEFAULT_URL})
  --yes         With load: store an update to an existing subject without asking again
  --help        Show this text
`;

/** How many positional arguments each command takes after its name. */
const ARITY = { status: 0, validate: 1, load: 1, export: 2 } as const;

const isCommandName = (name: string): name is keyof typeof ARITY => Object.hasOwn(ARITY, name);

/** Turns the arguments after the program name into a command, never throwing for bad input. */
export function parseCommand(argv: readonly string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { url: { type: 'string' }, help: { type: 'boolean' }, yes: { type: 'boolean' } },
      allowPositionals: true,
    });
  } catch (thrown) {
    return { kind: 'invalid', message: thrown instanceof Error ? thrown.message : String(thrown) };
  }

  if (parsed.values.help === true) {
    return { kind: 'help' };
  }
  const [name, ...rest] = parsed.positionals;
  if (name === undefined) {
    return { kind: 'help' };
  }
  if (!isCommandName(name)) {
    return { kind: 'invalid', message: `Unknown command "${name}"` };
  }
  const arity = ARITY[name];
  if (rest.length > arity) {
    return { kind: 'invalid', message: `Unexpected argument "${rest[arity]}"` };
  }
  if (rest.length < arity) {
    return { kind: 'invalid', message: `"${name}" needs ${arity === 1 ? 'a pack folder or .zip' : 'a subject id and a target'}` };
  }
  if (parsed.values.yes === true && name !== 'load') {
    return { kind: 'invalid', message: '--yes applies only to load' };
  }

  const url = parsed.values.url ?? DEFAULT_URL;
  if (!URL.canParse(url)) {
    return { kind: 'invalid', message: `"${url}" is not a URL` };
  }
  const [first = '', second = ''] = rest;
  switch (name) {
    case 'status':
      return { kind: 'status', url };
    case 'validate':
      return { kind: 'validate', path: first };
    case 'load':
      return { kind: 'load', path: first, url, yes: parsed.values.yes === true };
    case 'export':
      return { kind: 'export', subject: first, target: second, url };
    default: {
      const unhandled: never = name;
      return unhandled;
    }
  }
}
