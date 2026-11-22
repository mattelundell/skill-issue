import { describe, expect, it } from 'vitest';
import { HealthResponseSchema, minutesFor, ModuleIdSchema, requeue } from './index.js';

describe('HealthResponseSchema', () => {
  it('accepts a healthy answer with its module list', () => {
    const parsed = HealthResponseSchema.parse({
      status: 'ok',
      version: '1.2.3',
      database: 'up',
      modules: ['content', 'notes'],
    });
    expect(parsed).toEqual({ status: 'ok', version: '1.2.3', database: 'up', modules: ['content', 'notes'] });
  });

  it('rejects "ok" combined with a database that is down', () => {
    const result = HealthResponseSchema.safeParse({ status: 'ok', version: '1', database: 'down', modules: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['database']);
  });
});

describe('ModuleIdSchema', () => {
  it.each(['Content', '1notes', 'my_module', ''])('rejects %j', (id) => {
    expect(ModuleIdSchema.safeParse(id).success).toBe(false);
  });

  it.each(['content', 'learning-record', 'v2'])('accepts %j', (id) => {
    expect(ModuleIdSchema.parse(id)).toBe(id);
  });
});

describe('a question answered wrong in a review session', () => {
  it('waits behind the next three, or goes to the end when fewer are left, or straight back when it is the last', () => {
    expect(requeue(['a', 'b', 'c', 'd', 'e'], 'x')).toEqual(['a', 'b', 'c', 'x', 'd', 'e']);
    expect(requeue(['a', 'b'], 'x')).toEqual(['a', 'b', 'x']);
    expect(requeue([], 'x')).toEqual(['x']);
  });
});

describe('the time a review takes', () => {
  it('is the questions at the learner’s pace, in whole minutes and at least one, and unsaid before there is a pace', () => {
    expect(minutesFor(14, 25_000)).toBe(6);
    expect(minutesFor(2, 20_000)).toBe(1);
    expect(minutesFor(3, null)).toBeUndefined();
    expect(minutesFor(0, 20_000)).toBeUndefined();
  });
});
