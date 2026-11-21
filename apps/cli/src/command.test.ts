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

  it('reads validate, load and export with their arguments', () => {
    expect(parseCommand(['validate', 'packs/energi'])).toEqual({ kind: 'validate', path: 'packs/energi' });
    expect(parseCommand(['load', 'energi.zip'])).toEqual({ kind: 'load', path: 'energi.zip', url: 'http://127.0.0.1:4747', yes: false });
    expect(parseCommand(['load', 'energi', '--yes', '--url', 'http://localhost:9000'])).toEqual({ kind: 'load', path: 'energi', url: 'http://localhost:9000', yes: true });
    expect(parseCommand(['export', 'energi', 'out.zip'])).toEqual({ kind: 'export', subject: 'energi', target: 'out.zip', url: 'http://127.0.0.1:4747' });
  });

  it.each([
    [['validate'], '"validate" needs a pack folder or .zip'],
    [['export', 'energi'], '"export" needs a subject id and a target'],
    [['load', 'a', 'b'], 'Unexpected argument "b"'],
    [['export', 'energi', 'out', '--yes'], '--yes applies only to load'],
  ])('names what is wrong with %j', (argv, message) => {
    expect(parseCommand(argv)).toEqual({ kind: 'invalid', message });
  });

  it('reports an unknown option instead of throwing', () => {
    const command = parseCommand(['status', '--verbose']);
    expect(command).toMatchObject({ kind: 'invalid' });
    expect(command.kind === 'invalid' ? command.message : '').toContain('--verbose');
  });
});
