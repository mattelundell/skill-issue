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

  it('takes its default address from SKILL_ISSUE_URL, which --url still overrides', () => {
    const env = { SKILL_ISSUE_URL: 'http://app:4747' };
    expect(parseCommand(['status'], env)).toEqual({ kind: 'status', url: 'http://app:4747' });
    expect(parseCommand(['status', '--url', 'http://localhost:9000'], env)).toEqual({ kind: 'status', url: 'http://localhost:9000' });
    expect(parseCommand(['status'], { SKILL_ISSUE_URL: 'not a url' })).toEqual({ kind: 'invalid', message: '"not a url" is not a URL' });
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

  it('reads backup, restore and export-notes with their arguments', () => {
    const url = 'http://127.0.0.1:4747';
    expect(parseCommand(['backup', 'b.json'])).toEqual({ kind: 'backup', target: 'b.json', url });
    expect(parseCommand(['restore', 'b.json'])).toEqual({ kind: 'restore', path: 'b.json', url, dryRun: false });
    expect(parseCommand(['restore', 'b.json', '--dry-run'])).toEqual({ kind: 'restore', path: 'b.json', url, dryRun: true });
    expect(parseCommand(['export-notes', 'energi', 'n.md'])).toEqual({ kind: 'export-notes', subject: 'energi', target: 'n.md', url, language: undefined, interfaceLanguage: 'en' });
    expect(parseCommand(['export-notes', 'energi', 'n.md', '--language', 'sv', '--interface', 'sv'])).toEqual({
      kind: 'export-notes',
      subject: 'energi',
      target: 'n.md',
      url,
      language: 'sv',
      interfaceLanguage: 'sv',
    });
  });

  it('reads review across every subject, or in one', () => {
    expect(parseCommand(['review'])).toEqual({ kind: 'review', subject: undefined, url: 'http://127.0.0.1:4747' });
    expect(parseCommand(['review', 'energi'])).toEqual({ kind: 'review', subject: 'energi', url: 'http://127.0.0.1:4747' });
  });

  it('reads an exam of a lesson or an area, in the subject\'s own language or a given one', () => {
    const url = 'http://127.0.0.1:4747';
    expect(parseCommand(['exam', 'energi', 'lesson', 'effekt-och-energi'])).toEqual({ kind: 'exam', subject: 'energi', scope: { kind: 'lesson', id: 'effekt-och-energi' }, url, language: undefined });
    expect(parseCommand(['exam', 'energi', 'area', 'grunder', '--language', 'en'])).toEqual({ kind: 'exam', subject: 'energi', scope: { kind: 'area', id: 'grunder' }, url, language: 'en' });
  });

  it.each([
    [['exam', 'energi', 'lesson'], '"exam" needs a subject id, lesson or area, and its id'],
    [['exam', 'energi', 'chapter', 'grunder'], '"exam" covers a lesson or an area, not "chapter"'],
    [['validate'], '"validate" needs a pack folder or .zip'],
    [['backup'], '"backup" needs a file to write'],
    [['restore'], '"restore" needs a backup file'],
    [['export-notes', 'energi'], '"export-notes" needs a subject id and a file to write'],
    [['review', 'a', 'b'], 'Unexpected argument "b"'],
    [['backup', 'b.json', '--dry-run'], '--dry-run applies only to restore'],
    [['review', '--language', 'sv'], '--language applies only to export-notes and exam'],
    [['exam', 'energi', 'lesson', 'x', '--interface', 'sv'], '--interface applies only to export-notes'],
    [['export-notes', 'energi', 'n.md', '--interface', 'fi'], '--interface must be en or sv'],
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
