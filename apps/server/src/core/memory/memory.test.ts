import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { dayIn, guessChance, ratingOf, SCHEDULER, SCHEDULER_ID } from './memory.js';

describe('the scheduler', () => {
  it('names the library version that is installed, and the dependency pins exactly that one', () => {
    const require = createRequire(import.meta.url);
    const installed: unknown = JSON.parse(readFileSync(join(require.resolve('ts-fsrs').replace(/dist[\\/].*$/, ''), 'package.json'), 'utf8'));
    const manifest: unknown = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8'));

    expect(installed).toMatchObject({ version: SCHEDULER.version });
    expect(manifest).toMatchObject({ dependencies: { 'ts-fsrs': SCHEDULER.version } });
  });

  it('is named by everything that changes a due date, so changing any of them replays the record', () => {
    expect(SCHEDULER_ID).toBe('ts-fsrs@6.0.0 FSRS-6 retention=0.9 short-term=false fuzz=false');
  });
});

describe('the rating an answer gives', () => {
  it('is "again" for any wrong answer, whatever its type', () => {
    expect(ratingOf({ correct: false, questionType: 'numeric', options: undefined })).toBe(Rating.Again);
    expect(ratingOf({ correct: false, questionType: 'true-false', options: 2 })).toBe(Rating.Again);
    expect(ratingOf({ correct: false, questionType: 'single-choice', options: 5 })).toBe(Rating.Again);
  });

  it('is "good" for a right answer that a guess would seldom hit', () => {
    expect(ratingOf({ correct: true, questionType: 'numeric', options: undefined })).toBe(Rating.Good);
    expect(ratingOf({ correct: true, questionType: 'short-text', options: undefined })).toBe(Rating.Good);
    expect(ratingOf({ correct: true, questionType: 'free-recall', options: undefined })).toBe(Rating.Good);
    expect(ratingOf({ correct: true, questionType: 'single-choice', options: 4 })).toBe(Rating.Good);
    expect(ratingOf({ correct: true, questionType: 'multiple-choice', options: 3 })).toBe(Rating.Good);
    expect(ratingOf({ correct: true, questionType: 'ordering', options: 3 })).toBe(Rating.Good);
  });

  it('is "hard" for a right answer a guess would hit one time in three or more often', () => {
    expect(ratingOf({ correct: true, questionType: 'true-false', options: 2 })).toBe(Rating.Hard);
    expect(ratingOf({ correct: true, questionType: 'single-choice', options: 3 })).toBe(Rating.Hard);
    expect(ratingOf({ correct: true, questionType: 'single-choice', options: 2 })).toBe(Rating.Hard);
    expect(ratingOf({ correct: true, questionType: 'matching', options: 2 })).toBe(Rating.Hard);
  });
});

describe('the chance of a lucky guess', () => {
  it('is one option in n, one non-empty selection, one order or one pairing', () => {
    expect(guessChance('single-choice', 4)).toBe(1 / 4);
    expect(guessChance('true-false', 2)).toBe(1 / 2);
    expect(guessChance('multiple-choice', 3)).toBe(1 / 7);
    expect(guessChance('ordering', 4)).toBe(1 / 24);
    expect(guessChance('matching', 3)).toBe(1 / 6);
    expect(guessChance('numeric', undefined)).toBe(0);
  });
});

describe('the day an instant falls on', () => {
  it('is the learner’s own calendar day, not the UTC one', () => {
    const lateEvening = new Date('2026-11-21T23:30:00Z');

    expect(dayIn(lateEvening, 'UTC')).toBe('2026-11-21');
    expect(dayIn(lateEvening, 'Europe/Stockholm')).toBe('2026-11-22');
    expect(dayIn(lateEvening, 'America/New_York')).toBe('2026-11-21');
  });
});
