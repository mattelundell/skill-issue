// In a test the two assertions that silence the checker are allowed, and a
// focused test is not: it would quietly skip every other test in the file.
import { expect, it } from 'vitest';

declare function parse(text: string): unknown;
declare const maybe: string | undefined;

it.only('is focused', () => { // expect: vitest/no-focused-tests
  const asserted = parse('x') as string;
  const forced = maybe!;
  expect(asserted + forced).toBe('xx');
});
