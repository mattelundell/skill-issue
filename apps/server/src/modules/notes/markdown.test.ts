import type { NotebookSection, SubjectOutline } from '@skill-issue/contract';
import { describe, expect, it } from 'vitest';
import { headingsBelow, imagesReferenced, notebookFiles } from './markdown.js';

describe('a learner’s headings in the exported notebook', () => {
  it('go below the notebook’s own, so a heading the learner wrote cannot read as a new area or lesson', () => {
    expect(headingsBelow('## Min sammanfattning\n\nText.\n\n# Överst\n\n#### Djupt', 2)).toBe('#### Min sammanfattning\n\nText.\n\n### Överst\n\n###### Djupt');
  });

  it('leave alone what only looks like a heading: a hash inside a code block, or one with no space after it', () => {
    const note = 'Före\n\n```sh\n# en kommentar\n```\n\n#taggen\n\n~~~\n## också kod\n~~~';
    expect(headingsBelow(note, 2)).toBe(note);
  });

  it('keep a heading indented up to three spaces, as Markdown reads it', () => {
    expect(headingsBelow('   ## Indragen', 2)).toBe('   #### Indragen');
  });
});

describe('the images a notebook references', () => {
  it('are the names after bilder/ in its image links, each once, and nothing that only looks like one', () => {
    const bodies = ['Före ![skärm](bilder/bild-2.png) och ![igen](bilder/bild-2.png)', '![x](bilder/bild-10.webp)\n`![kod](bilder/bild-3.png)` är också en länk', '[inte en bild](bilder/bild-4.png) ![utanför](../bild-5.png) ![svg](bilder/bild-6.svg)'];
    expect(imagesReferenced(bodies)).toEqual(['bild-10.webp', 'bild-2.png', 'bild-3.png']);
  });
});

const SUBJECT: SubjectOutline = {
  id: 'energi',
  title: 'Energi och hållbarhet',
  language: 'sv',
  languages: ['sv'],
  areas: [
    { id: 'grunder', title: 'Grunder', lessons: [{ id: 'energi-och-effekt', title: 'Energi och effekt' }, { id: 'u-varde', title: 'U-värde och Um' }] },
    { id: 'matdata', title: 'Mätdata', lessons: [{ id: 'signatur', title: 'Energisignatur' }] },
    { id: 'tomt', title: 'Ingenting skrivet', lessons: [{ id: 'orord', title: 'Orörd' }] },
  ],
} as unknown as SubjectOutline;

const at = (kind: 'area' | 'lesson', itemId: string, body: string): NotebookSection => ({
  subjectId: 'energi',
  kind,
  itemId,
  body,
  createdAt: '2026-11-22T10:00:00.000Z',
  updatedAt: '2026-11-22T10:00:00.000Z',
});

describe('a notebook as Markdown files', () => {
  const sections = [
    at('lesson', 'signatur', '# Vad jag tar med mig\n\n![signatur](bilder/bild-1.png)'),
    at('lesson', 'energi-och-effekt', 'Effekt × tid = energi.'),
    at('area', 'grunder', 'Området i en mening.'),
    at('lesson', 'borttagen', 'Skrivet i en lektion som inte finns kvar.'),
  ];
  const files = notebookFiles(SUBJECT, sections, 'sv');

  it('writes one file per area with something in it, numbered in the order of the path, and a README linking them', () => {
    expect([...files.keys()]).toEqual(['README.md', '01-grunder.md', '02-matdata.md', '99-inte-langre-i-amnet.md']);
    expect(files.get('README.md')).toBe(
      '# Energi och hållbarhet — anteckningar\n\n- [Grunder](01-grunder.md)\n- [Mätdata](02-matdata.md)\n- [Inte längre i ämnet](99-inte-langre-i-amnet.md)\n',
    );
  });

  it('puts the area’s own section under its title and each written lesson under its own, in the order of the path, leaving unwritten lessons out', () => {
    expect(files.get('01-grunder.md')).toBe('# Grunder\n\nOmrådet i en mening.\n\n## Energi och effekt\n\nEffekt × tid = energi.\n');
  });

  it('moves the learner’s headings below the lesson’s and keeps image links as written, since the images lie beside the files in bilder/', () => {
    expect(files.get('02-matdata.md')).toBe('# Mätdata\n\n## Energisignatur\n\n### Vad jag tar med mig\n\n![signatur](bilder/bild-1.png)\n');
  });

  it('keeps a section whose lesson the subject no longer holds, under the lesson’s id', () => {
    expect(files.get('99-inte-langre-i-amnet.md')).toBe('# Inte längre i ämnet\n\n## Lektionen borttagen\n\nSkrivet i en lektion som inte finns kvar.\n');
  });

  it('names its own headings in the interface language', () => {
    expect(notebookFiles(SUBJECT, sections, 'en').get('README.md')).toMatch(/^# Energi och hållbarhet — notes\n/);
  });

  it('says so in the README when nothing is written', () => {
    expect(notebookFiles(SUBJECT, [], 'sv')).toEqual(new Map([['README.md', '# Energi och hållbarhet — anteckningar\n\nInga anteckningar än.\n']]));
  });
});
