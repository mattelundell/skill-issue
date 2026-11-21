import { describe, expect, it } from 'vitest';
import { orderMigrations, type Migration } from './migrate.js';

const m = (owner: string, name: string): Migration => ({ owner, name, sql: '' });
const order = (migrations: readonly Migration[]): string[] => orderMigrations(migrations).map(({ owner, name }) => `${owner}/${name}`);

describe('orderMigrations', () => {
  it("applies the core's migrations before any module's, whatever the module is called", () => {
    // A module's tables may refer to the catalogue, so the catalogue must exist first.
    expect(order([m('assessment', '0001_init'), m('core', '0001_catalogue'), m('content', '0001_init')])).toEqual([
      'core/0001_catalogue',
      'assessment/0001_init',
      'content/0001_init',
    ]);
  });

  it('sorts by code unit, so the order is the same on every machine whatever its locale', () => {
    // A locale-aware comparison puts "a" before "B"; code units put "B" (66) before "a" (97).
    expect(order([m('notes', '0002_a'), m('notes', '0002_B'), m('Notes', '0001_x'), m('notes', '0001_init')])).toEqual([
      'Notes/0001_x',
      'notes/0001_init',
      'notes/0002_B',
      'notes/0002_a',
    ]);
  });
});
