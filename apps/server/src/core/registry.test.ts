import { describe, expect, it } from 'vitest';
import { createRegistry, type ModuleManifest } from './registry.js';

const moduleNamed = (id: string, migrationNames: readonly string[] = []): ModuleManifest => ({
  id,
  migrations: migrationNames.map((name) => ({ name, sql: `-- ${id}/${name}` })),
});

describe('createRegistry', () => {
  it('keeps the modules in the order given and attributes each migration to its module', () => {
    const result = createRegistry([moduleNamed('notes', ['0001_init']), moduleNamed('review', ['0001_init', '0002_more'])]);

    expect(result).toEqual({
      ok: true,
      value: {
        modules: [expect.objectContaining({ id: 'notes' }), expect.objectContaining({ id: 'review' })],
        migrations: [
          { owner: 'notes', name: '0001_init', sql: '-- notes/0001_init' },
          { owner: 'review', name: '0001_init', sql: '-- review/0001_init' },
          { owner: 'review', name: '0002_more', sql: '-- review/0002_more' },
        ],
      },
    });
  });

  it('refuses two modules with the same id, naming it', () => {
    expect(createRegistry([moduleNamed('notes'), moduleNamed('review'), moduleNamed('notes')])).toEqual({
      ok: false,
      error: { kind: 'duplicate-id', id: 'notes' },
    });
  });

  it.each(['core', 'platform', 'health', 'openapi'])('refuses the reserved id %j', (id) => {
    expect(createRegistry([moduleNamed(id)])).toEqual({ ok: false, error: { kind: 'reserved-id', id } });
  });

  it.each(['Notes', 'my_module', '../etc', ''])('refuses the malformed id %j', (id) => {
    expect(createRegistry([moduleNamed(id)])).toEqual({ ok: false, error: { kind: 'invalid-id', id } });
  });
});
