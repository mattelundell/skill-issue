import { parseArgs } from 'node:util';

export const DEFAULT_URL = 'http://127.0.0.1:4747';

export type Command =
  | { readonly kind: 'status'; readonly url: string }
  | { readonly kind: 'help' }
  | { readonly kind: 'invalid'; readonly message: string };

export const USAGE = `Usage: skill-issue <command> [options]

Commands:
  status        Show whether the application is up and which modules it runs

Options:
  --url <url>   Where the application listens (default ${DEFAULT_URL})
  --help        Show this text
`;

/** Turns the arguments after the program name into a command, never throwing for bad input. */
export function parseCommand(argv: readonly string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { url: { type: 'string' }, help: { type: 'boolean' } },
      allowPositionals: true,
    });
  } catch (thrown) {
    return { kind: 'invalid', message: thrown instanceof Error ? thrown.message : String(thrown) };
  }

  if (parsed.values.help === true) {
    return { kind: 'help' };
  }
  const [name, ...extra] = parsed.positionals;
  if (name === undefined) {
    return { kind: 'help' };
  }
  if (name !== 'status') {
    return { kind: 'invalid', message: `Unknown command "${name}"` };
  }
  if (extra.length > 0) {
    return { kind: 'invalid', message: `Unexpected argument "${extra[0]}"` };
  }

  const url = parsed.values.url ?? DEFAULT_URL;
  if (!URL.canParse(url)) {
    return { kind: 'invalid', message: `"${url}" is not a URL` };
  }
  return { kind: 'status', url };
}
