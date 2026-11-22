import { describe, expect, it } from 'vitest';
import { underStep } from './markdown.js';

describe('a note filed under its step in the Markdown file', () => {
  it('keeps its own headings below the step’s, so a heading the learner wrote cannot read as a new area or lesson', () => {
    expect(underStep('## Min sammanfattning\n\nText.\n\n# Överst\n\n### Djupt')).toBe('###### Min sammanfattning\n\nText.\n\n##### Överst\n\n###### Djupt');
  });

  it('leaves alone what only looks like a heading: a hash inside a code block, or one with no space after it', () => {
    const note = 'Före\n\n```sh\n# en kommentar\n```\n\n#taggen\n\n~~~\n## också kod\n~~~';
    expect(underStep(note)).toBe(note);
  });

  it('keeps a heading indented up to three spaces, as Markdown reads it', () => {
    expect(underStep('   ## Indragen')).toBe('   ###### Indragen');
  });
});
