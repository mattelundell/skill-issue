type Fields = Readonly<Record<string, unknown>>;

function write(level: 'info' | 'error', event: string, fields: Fields): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

/** One JSON object per line: readable by a person, parseable by a tool. */
export const log = {
  info: (event: string, fields: Fields = {}): void => write('info', event, fields),
  error: (event: string, fields: Fields = {}): void => write('error', event, fields),
};

/** The message of anything thrown, without assuming it is an Error. */
export function describeThrown(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
