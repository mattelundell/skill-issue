import { describe, expect, it } from 'vitest';
import { fetchStatus, report } from './status.js';

describe('report', () => {
  it('lists version and modules when the application is up', () => {
    const result = report({
      kind: 'answered',
      health: { status: 'ok', version: '0.1.0', database: 'up', modules: ['content', 'notes'] },
    });
    expect(result).toEqual({ text: 'Skill Issue 0.1.0 is up.\nModules: content, notes', exitCode: 0 });
  });

  it('says what is due in each subject, and about how long it takes, when review runs', () => {
    const result = report({
      kind: 'answered',
      health: { status: 'ok', version: '0.1.0', database: 'up', modules: ['review'] },
      due: { subjects: { statistik: { due: 0, typicalAnswerMs: 5000 }, energi: { due: 14, typicalAnswerMs: 25_000 } }, questions: [] },
    });
    expect(result).toEqual({ text: 'Skill Issue 0.1.0 is up.\nModules: review\nDue today:\n  energi     14, about 6 minutes\n  statistik   0', exitCode: 0 });
  });

  it('says when nothing is due in any subject', () => {
    const result = report({ kind: 'answered', health: { status: 'ok', version: '0.1.0', database: 'up', modules: ['review'] }, due: { subjects: {}, questions: [] } });
    expect(result).toEqual({ text: 'Skill Issue 0.1.0 is up.\nModules: review\nNothing is due today.', exitCode: 0 });
  });

  it('says so when what is due could not be read, rather than leaving it out', () => {
    const result = report({ kind: 'answered', health: { status: 'ok', version: '0.1.0', database: 'up', modules: ['review'] }, due: { unread: 'the application answered 500' } });
    expect(result).toEqual({ text: 'Skill Issue 0.1.0 is up.\nModules: review\nWhat is due could not be read: the application answered 500.', exitCode: 1 });
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

/** An application answering each request in turn with a status and a JSON body. */
const answering = (...bodies: readonly [number, unknown][]): typeof fetch => {
  const queue = [...bodies];
  return async () => {
    const [status, body] = queue.shift() ?? [599, null];
    return new Response(JSON.stringify(body), { status });
  };
};

describe('fetchStatus', () => {
  const health = { status: 'ok', version: '0.1.0', database: 'up', modules: ['review'] };

  it('reads what is due in the learner’s time zone when review runs', async () => {
    const asked: string[] = [];
    const due = { subjects: { energi: { due: 3, typicalAnswerMs: null } }, questions: [] };
    const fake: typeof fetch = async (input) => {
      asked.push(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
      return new Response(JSON.stringify(asked.length === 1 ? health : due), { status: 200 });
    };

    expect(await fetchStatus('http://127.0.0.1:4747', 'Europe/Stockholm', fake)).toEqual({ kind: 'answered', health, due });
    expect(asked).toEqual(['http://127.0.0.1:4747/api/v1/health', 'http://127.0.0.1:4747/api/v1/review/due?timeZone=Europe%2FStockholm']);
  });

  it('keeps that what is due could not be read, with the status it was answered with', async () => {
    const outcome = await fetchStatus('http://127.0.0.1:4747', 'UTC', answering([200, health], [500, { title: 'Internal error' }]));

    expect(outcome).toEqual({ kind: 'answered', health, due: { unread: 'the application answered 500' } });
  });
});
