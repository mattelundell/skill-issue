import { describe, expect, it } from 'vitest';
import { report } from './status.js';

describe('report', () => {
  it('lists version and modules when the application is up', () => {
    const result = report({
      kind: 'answered',
      health: { status: 'ok', version: '0.1.0', database: 'up', modules: ['content', 'notes'] },
    });
    expect(result).toEqual({ text: 'Skill Issue 0.1.0 is up.\nModules: content, notes', exitCode: 0 });
  });

  it('fails when the database is down', () => {
    const result = report({ kind: 'answered', health: { status: 'unavailable', version: '0.1.0', database: 'down' } });
    expect(result).toEqual({
      text: 'Skill Issue 0.1.0 is running, but its database cannot be reached.',
      exitCode: 1,
    });
  });

  it('fails, naming the address, when nothing answers', () => {
    expect(report({ kind: 'unreachable', url: 'http://127.0.0.1:4747' })).toEqual({
      text: 'Nothing answers at http://127.0.0.1:4747. Is the application started?',
      exitCode: 1,
    });
  });

  it('fails when something else answers there', () => {
    expect(report({ kind: 'not-skill-issue', url: 'http://127.0.0.1:80' })).toEqual({
      text: 'Something answers at http://127.0.0.1:80, but it is not Skill Issue.',
      exitCode: 1,
    });
  });
});
