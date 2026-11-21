import { describe, expect, it } from 'vitest';
import { parseCommand } from './command.js';

describe('parseCommand', () => {
  it('reads status against the default address', () => {
    expect(parseCommand(['status'])).toEqual({ kind: 'status', url: 'http://127.0.0.1:4747' });
  });

  it('reads status against a given address', () => {
    expect(parseCommand(['status', '--url', 'http://localhost:9000'])).toEqual({ kind: 'status', url: 'http://localhost:9000' });
  });

  it.each([[[]], [['--help']], [['status', '--help']]])('shows help for %j', (argv) => {
    expect(parseCommand(argv)).toEqual({ kind: 'help' });
  });

  it('names an unknown command', () => {
    expect(parseCommand(['stauts'])).toEqual({ kind: 'invalid', message: 'Unknown command "stauts"' });
  });

  it('names a surplus argument', () => {
    expect(parseCommand(['status', 'now'])).toEqual({ kind: 'invalid', message: 'Unexpected argument "now"' });
  });

  it('names an address that is not a URL', () => {
    expect(parseCommand(['status', '--url', 'not a url'])).toEqual({ kind: 'invalid', message: '"not a url" is not a URL' });
  });

  it('reports an unknown option instead of throwing', () => {
    const command = parseCommand(['status', '--verbose']);
    expect(command).toMatchObject({ kind: 'invalid' });
    expect(command.kind === 'invalid' ? command.message : '').toContain('--verbose');
  });
});
