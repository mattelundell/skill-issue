import { join } from 'node:path';
import type { ContentFault, Pack } from '@skill-issue/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkPack, checkPackFiles, decodePack, encodePack, readFolder, type PackFiles } from './index.js';
import { sortFaults } from './location.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');

const LESSON_1 = 'areas/grunder/lessons/energi-och-effekt';
const QUESTIONS_1 = `${LESSON_1}/questions.yaml`;
const QUESTIONS_1_EN = `${LESSON_1}/questions.en.yaml`;
const LESSON_3 = 'areas/fordjupning/lessons/energibalans';

let example: PackFiles;

beforeAll(async () => {
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(read.error)}`);
  }
  example = read.value;
});

const text = (files: PackFiles, path: string): string => {
  const bytes = files.get(path);
  if (bytes === undefined) {
    throw new Error(`no ${path} in the example pack`);
  }
  return new TextDecoder().decode(bytes);
};

/** The example pack with one file's text changed; the replaced text must be there, or the case tests nothing. */
function edited(path: string, from: string, to: string): PackFiles {
  const before = text(example, path);
  if (!before.includes(from)) {
    throw new Error(`${path} does not contain ${JSON.stringify(from)}`);
  }
  return new Map(example).set(path, new TextEncoder().encode(before.replace(from, to)));
}

/** The example with both of its subject files saying the subject has this role. */
function asRole(role: string): PackFiles {
  const files = new Map(example);
  for (const path of ['subject.yaml', 'subject.en.yaml']) {
    files.set(path, new TextEncoder().encode(text(example, path).replace('id: example-subject\n', `id: example-subject\nrole: ${role}\n`)));
  }
  return files;
}

const withFile = (path: string, content: string | Uint8Array): PackFiles =>
  new Map(example).set(path, typeof content === 'string' ? new TextEncoder().encode(content) : content);

const without = (path: string): PackFiles => {
  const files = new Map(example);
  files.delete(path);
  return files;
};

const faultsOf = (files: PackFiles): readonly ContentFault[] => {
  const result = checkPackFiles(files);
  return result.ok ? [] : result.error;
};

const f = (code: string, file: string, item: string | null, field: string, expected: string, found: string): ContentFault => ({
  code,
  file,
  item,
  field,
  expected,
  found,
});

/** The fault a translation draws when its original is edited and it is not: the original's structure, and its own. */
const mismatch = (file: string, item: string, field: string, expected: string, found: string): ContentFault =>
  f('translation-mismatch', file, item, field, `the same as in the default language: ${expected}`, found);

/** The ids among these items that are missing in Swedish or in English. */
const missingInEither = (items: readonly { id: string; language: string }[]): string[] =>
  [...new Set(items.map((item) => item.id))].filter((id) => !(items.some((item) => item.id === id && item.language === 'sv') && items.some((item) => item.id === id && item.language === 'en')));

describe('an introduction', () => {
  it('ships with the application: it passes every check, says it is an introduction, and has every item in both languages', async () => {
    const read = await readFolder(join(import.meta.dirname, '..', '..', '..', 'examples', 'introduction'));
    if (!read.ok) {
      throw new Error(`introduction unreadable: ${JSON.stringify(read.error)}`);
    }
    const result = checkPackFiles(read.value);
    if (!result.ok) {
      throw new Error(`introduction does not check: ${JSON.stringify(result.error)}`);
    }
    const pack = result.value;
    expect(pack.subject.map(({ id, language, role }) => ({ id, language, role }))).toEqual([
      { id: 'kom-igang', language: 'en', role: 'introduction' },
      { id: 'kom-igang', language: 'sv', role: 'introduction' },
    ]);
    // Every lesson, question, area, source and term is there in English as well as Swedish.
    expect({
      lessons: missingInEither(pack.lessons),
      questions: missingInEither(pack.questions),
      areas: missingInEither(pack.areas),
      sources: missingInEither(pack.sources),
      glossary: missingInEither(pack.glossary),
    }).toEqual({ lessons: [], questions: [], areas: [], sources: [], glossary: [] });
    expect(pack.lessons.filter((lesson) => lesson.language === 'sv').map((lesson) => lesson.id)).toEqual(['sa-laser-du', 'sen']);
  });

  it('passes when every subject file says so, and keeps the role in each', () => {
    const result = checkPackFiles(asRole('introduction'));
    expect(result.ok ? result.value.subject.map(({ language, role }) => ({ language, role })) : result.error).toEqual([
      { language: 'en', role: 'introduction' },
      { language: 'sv', role: 'introduction' },
    ]);
  });
});

describe('the example pack', () => {
  it('passes every check, with every item in place', () => {
    const result = checkPackFiles(example);

    expect(result.ok ? [] : result.error).toEqual([]);
    const pack = result.ok ? result.value : undefined;
    expect(pack?.subject.map((s) => [s.language, s.title])).toEqual([
      ['en', 'Example subject'],
      ['sv', 'Exempelämne'],
    ]);
    expect(pack?.areas.map((a) => a.id)).toEqual(['fordjupning', 'grunder']);
    expect(pack?.lessons.map((l) => `${l.id}/${l.language}`)).toEqual([
      'energibalans/sv',
      'energi-och-effekt/en',
      'energi-och-effekt/sv',
      'enhetsprefix/sv',
    ]);
    expect(pack?.questions.filter((q) => q.language === 'sv').map((q) => `${q.lesson}:${q.id}:${q.type}`)).toEqual([
      'energibalans:vagar-ut:multiple-choice',
      'energibalans:forklara-balans:free-recall',
      'energi-och-effekt:kwh-eller-kw:single-choice',
      'energi-och-effekt:berakna-energi:numeric',
      'energi-och-effekt:effekt-ar-takt:true-false',
      'enhetsprefix:prefix-ordning:ordering',
      'enhetsprefix:prefix-par:matching',
      'enhetsprefix:kilo-betyder:short-text',
    ]);
    expect(pack?.assets.map((a) => [a.path, a.mediaType])).toEqual([['assets/energiflode.png', 'image/png']]);
  });

  it('reads a lesson into its steps, with the header separated from the body', () => {
    const result = checkPackFiles(example);
    const lesson = result.ok ? result.value.lessons.find((l) => l.id === 'energi-och-effekt' && l.language === 'sv') : undefined;

    expect(lesson?.steps).toEqual([
      {
        type: 'text',
        body: '**Effekt** är hur fort energi används, och mäts i watt (W) eller kilowatt (kW).\n**Energi** är hur mycket som används totalt, och mäts i kilowattimmar (kWh).',
      },
      { type: 'example', body: 'En värmefläkt på 2 kW som går i 3 timmar använder 2 kW × 3 h = 6 kWh.' },
      { type: 'check', questions: ['kwh-eller-kw', 'berakna-energi'] },
    ]);
  });

  it('comes back unchanged after being written as files and read again', () => {
    const first = checkPackFiles(example);
    const pack: Pack | undefined = first.ok ? first.value : undefined;
    expect(pack).toBeDefined();

    const again = checkPackFiles(encodePack(pack!));

    expect(again).toEqual({ ok: true, value: pack });
  });
});

describe('a broken pack is rejected with every fault, each naming its file, item and field', () => {
  const cases: readonly [string, () => PackFiles, readonly ContentFault[]][] = [
    [
      'a question citing a source the pack lacks',
      () => edited(QUESTIONS_1, 'concepts: [effekt]\n  sources: [exempelkalla]\n  prompt: Vilken', 'concepts: [effekt]\n  sources: [boverket]\n  prompt: Vilken'),
      [mismatch(QUESTIONS_1_EN, 'question kwh-eller-kw', 'sources', '["boverket"]', '["exempelkalla"]'), f('unknown-source', QUESTIONS_1, 'question kwh-eller-kw', 'sources[0]', 'the id of a source in this pack', '"boverket"')],
    ],
    [
      'a check asking a question from another lesson',
      () => edited(`${LESSON_1}/lesson.md`, 'questions: [kwh-eller-kw, berakna-energi]', 'questions: [kwh-eller-kw, prefix-par]'),
      [mismatch(`${LESSON_1}/lesson.en.md`, 'lesson energi-och-effekt', 'steps[2].questions', '["kwh-eller-kw","prefix-par"]', '["kwh-eller-kw","berakna-energi"]'), f('question-not-in-bank', `${LESSON_1}/lesson.md`, 'lesson energi-och-effekt', 'steps[2].questions[1]', 'a question from this lesson\'s own bank; it belongs to "enhetsprefix"', '"prefix-par"')],
    ],
    [
      'a check asking a question that does not exist',
      () => edited(`${LESSON_1}/lesson.md`, 'questions: [kwh-eller-kw, berakna-energi]', 'questions: [kwh-eller-kw, saknas]'),
      [mismatch(`${LESSON_1}/lesson.en.md`, 'lesson energi-och-effekt', 'steps[2].questions', '["kwh-eller-kw","saknas"]', '["kwh-eller-kw","berakna-energi"]'), f('unknown-question', `${LESSON_1}/lesson.md`, 'lesson energi-och-effekt', 'steps[2].questions[1]', "the id of a question in this lesson's questions.yaml", '"saknas"')],
    ],
    [
      'a lesson exam drawing more questions than the bank holds',
      () => edited(`${LESSON_1}/lesson.md`, 'exam:\n  questions: 2', 'exam:\n  questions: 4'),
      [mismatch(`${LESSON_1}/lesson.en.md`, 'lesson energi-och-effekt', 'exam.questions', '4', '2'), f('exam-larger-than-bank', `${LESSON_1}/lesson.md`, 'lesson energi-och-effekt', 'exam.questions', "at most 3, the questions in this lesson's bank", '4')],
    ],
    [
      'an area exam drawing more questions than its lessons hold',
      () => edited('areas/grunder/area.yaml', 'questions: 4', 'questions: 7'),
      [f('exam-larger-than-bank', 'areas/grunder/area.yaml', 'area grunder', 'exam.questions', "at most 6, the questions in the banks of this area's lessons", '7')],
    ],
    [
      'a single-choice answer that is not one of the options',
      () => edited(QUESTIONS_1, 'answer: b', 'answer: d'),
      [mismatch(QUESTIONS_1_EN, 'question kwh-eller-kw', 'answer', '"d"', '"b"'), f('unknown-option', QUESTIONS_1, 'question kwh-eller-kw', 'answer', 'one of the option ids ["a","b","c"]', '"d"')],
    ],
    [
      'two options sharing an id',
      () => edited(QUESTIONS_1, '{ id: c, text: kWh/m² }', '{ id: a, text: kWh/m² }'),
      [mismatch(QUESTIONS_1_EN, 'question kwh-eller-kw', 'options', '["a","b","a"]', '["a","b","c"]'), f('duplicate-option', QUESTIONS_1, 'question kwh-eller-kw', 'options[2].id', 'each entry of options different from the others', '"a"')],
    ],
    [
      'raw HTML in a step',
      () => edited(`${LESSON_1}/lesson.md`, 'En värmefläkt', '<script>alert(1)</script>\n\nEn värmefläkt'),
      [f('raw-html', `${LESSON_1}/lesson.md`, 'lesson energi-och-effekt', 'steps[1].body', 'Markdown without HTML tags', '"<script>alert(1)</script>"')],
    ],
    [
      'an image from the web, a script link and a missing asset',
      () =>
        edited(
          `${LESSON_3}/lesson.md`,
          '![Energiflöde genom en byggnad](assets/energiflode.png)',
          '![a](https://example.org/x.png) [b](javascript:alert(1)) ![c](assets/saknas.png) [d](https://example.org) [e](mailto:a@example.org)',
        ),
      [
        f('remote-image', `${LESSON_3}/lesson.md`, 'lesson energibalans', 'steps[0].body', 'an image from the pack, as assets/<file>', '"https://example.org/x.png"'),
        f('unknown-asset', `${LESSON_3}/lesson.md`, 'lesson energibalans', 'steps[0].body', 'a file in the pack, as assets/<file>', '"assets/saknas.png"'),
        f('unsafe-link', `${LESSON_3}/lesson.md`, 'lesson energibalans', 'steps[0].body', 'a link to http, https, mailto or a file in assets/', '"javascript:alert(1)"'),
      ],
    ],
    [
      'a question without an explanation',
      () => edited(QUESTIONS_1, '  explanation: Effekt är energi per tidsenhet.\n', ''),
      [f('schema', QUESTIONS_1, 'question effekt-ar-takt', 'explanation', 'a value of type string', 'nothing')],
    ],
    [
      'a misspelt field',
      () => edited('areas/grunder/area.yaml', 'passMark: 0.75', 'passmark: 0.75'),
      [
        f('schema', 'areas/grunder/area.yaml', 'area grunder', 'exam.passMark', 'a value of type number', 'nothing'),
        f('unknown-field', 'areas/grunder/area.yaml', 'area grunder', 'exam.passmark', 'no field of this name', '0.75'),
      ],
    ],
    [
      'a step of a type the format does not have',
      () => edited(`${LESSON_1}/lesson.md`, 'type: example', 'type: video'),
      [f('schema', `${LESSON_1}/lesson.md`, 'lesson energi-och-effekt', 'steps[1].type', 'one of "text", "example", "check"', '"video"')],
    ],
    [
      'a lesson that no area lists',
      () => edited('areas/grunder/area.yaml', '  - enhetsprefix\n', ''),
      [
        f('lesson-misfiled', 'areas/grunder/lessons/enhetsprefix/lesson.md', 'lesson enhetsprefix', '', 'a lesson folder under the area whose area.yaml lists it; areas/grunder/area.yaml does not', '"areas/grunder/lessons/enhetsprefix/lesson.md"'),
        f('exam-larger-than-bank', 'areas/grunder/area.yaml', 'area grunder', 'exam.questions', "at most 3, the questions in the banks of this area's lessons", '4'),
        f('lesson-not-in-area', 'areas/(not listed in any area)/lessons/enhetsprefix/lesson.md', 'lesson enhetsprefix', 'id', 'a lesson listed under "lessons" in an area.yaml', '"enhetsprefix"'),
      ],
    ],
    [
      'a translation without an original',
      () => withFile('sources/annan.en.md', '---\nid: annan\ntitle: T\npublisher: P\naccessed: 2026-11-21\nlicence: unknown\nkind: summary\n---\n\nBody.\n'),
      [f('missing-original', 'sources/annan.en.md', 'source annan', 'language', 'the same source also in the default language "sv"', '"en"')],
    ],
    [
      'a translation giving a choice question another answer',
      () => edited(QUESTIONS_1_EN, 'answer: b', 'answer: a'),
      [f('translation-mismatch', QUESTIONS_1_EN, 'question kwh-eller-kw', 'answer', 'the same as in the default language: "b"', '"a"')],
    ],
    [
      'a translation naming its options with other ids',
      () => edited(QUESTIONS_1_EN, '{ id: c, text: kWh/m² }', '{ id: d, text: kWh/m² }'),
      [f('translation-mismatch', QUESTIONS_1_EN, 'question kwh-eller-kw', 'options', 'the same as in the default language: ["a","b","c"]', '["a","b","d"]')],
    ],
    [
      'a translation giving a numeric question another value, and a true-or-false question the opposite answer',
      () => {
        const once = edited(QUESTIONS_1_EN, 'answer: { value: 6, unit: kWh, tolerance: 0 }', 'answer: { value: 60, unit: kWh, tolerance: 0 }');
        const twice = new TextDecoder().decode(once.get(QUESTIONS_1_EN)).replace('answer: true', 'answer: false');
        return new Map(once).set(QUESTIONS_1_EN, new TextEncoder().encode(twice));
      },
      [
        f('translation-mismatch', QUESTIONS_1_EN, 'question berakna-energi', 'answer.value', 'the same as in the default language: 6', '60'),
        f('translation-mismatch', QUESTIONS_1_EN, 'question effekt-ar-takt', 'answer', 'the same as in the default language: true', 'false'),
      ],
    ],
    [
      'a translated lesson whose check asks other questions, and whose exam is another size',
      () => {
        const once = edited(`${LESSON_1}/lesson.en.md`, 'questions: [kwh-eller-kw, berakna-energi]', 'questions: [kwh-eller-kw, effekt-ar-takt]');
        const twice = new TextDecoder().decode(once.get(`${LESSON_1}/lesson.en.md`)).replace('exam:\n  questions: 2', 'exam:\n  questions: 3');
        return new Map(once).set(`${LESSON_1}/lesson.en.md`, new TextEncoder().encode(twice));
      },
      [
        f('translation-mismatch', `${LESSON_1}/lesson.en.md`, 'lesson energi-och-effekt', 'exam.questions', 'the same as in the default language: 2', '3'),
        f('translation-mismatch', `${LESSON_1}/lesson.en.md`, 'lesson energi-och-effekt', 'steps[2].questions', 'the same as in the default language: ["kwh-eller-kw","berakna-energi"]', '["kwh-eller-kw","effekt-ar-takt"]'),
      ],
    ],
    [
      'a translated lesson with a step fewer',
      () => {
        const lesson = text(example, `${LESSON_1}/lesson.en.md`);
        const steps = lesson.split('---step---');
        expect(steps.length).toBeGreaterThan(2);
        return withFile(`${LESSON_1}/lesson.en.md`, steps.slice(0, -1).join('---step---'));
      },
      [f('translation-mismatch', `${LESSON_1}/lesson.en.md`, 'lesson energi-och-effekt', 'steps', 'the same as in the default language: ["text","example","check"]', '["text","example"]')],
    ],
    [
      'a concept no lesson teaches',
      () => edited(QUESTIONS_1, 'concepts: [effekt]\n  sources: [exempelkalla]\n  prompt: Vilken', 'concepts: [verkningsgrad]\n  sources: [exempelkalla]\n  prompt: Vilken'),
      [mismatch(QUESTIONS_1_EN, 'question kwh-eller-kw', 'concepts', '["verkningsgrad"]', '["effekt"]'), f('unknown-concept', QUESTIONS_1, 'question kwh-eller-kw', 'concepts[0]', 'the id of a concept a lesson lists under "concepts" in this pack', '"verkningsgrad"')],
    ],
    [
      'a concept a lesson teaches that the subject does not declare',
      () => edited('subject.yaml', '  - { id: forluster, name: Förluster }\n', ''),
      [
        mismatch('subject.en.yaml', 'subject example-subject', 'concepts', '["energi","effekt","si-prefix","energibalans"]', '["energi","effekt","si-prefix","energibalans","forluster"]'),
        f('unknown-concept', `${LESSON_3}/lesson.md`, 'lesson energibalans', 'concepts[1]', 'the id of a concept the subject declares under "concepts" in this pack', '"forluster"'),
      ],
    ],
    [
      'a translation of the subject with its areas in another order, reported on the translation',
      () => edited('subject.en.yaml', 'areas:\n  - grunder\n  - fordjupning', 'areas:\n  - fordjupning\n  - grunder'),
      [mismatch('subject.en.yaml', 'subject example-subject', 'areas', '["grunder","fordjupning"]', '["fordjupning","grunder"]')],
    ],
    [
      'an introduction whose translation does not say it is one, reported on the translation',
      () => edited('subject.yaml', 'id: example-subject\n', 'id: example-subject\nrole: introduction\n'),
      [mismatch('subject.en.yaml', 'subject example-subject', 'role', '"introduction"', 'nothing')],
    ],
    [
      'a subject role the format does not have',
      () => asRole('tutorial'),
      [
        f('schema', 'subject.en.yaml', 'subject example-subject', 'role', '"introduction"', '"tutorial"'),
        f('schema', 'subject.yaml', 'subject example-subject', 'role', '"introduction"', '"tutorial"'),
      ],
    ],
    [
      'a subject that declares no concepts',
      () => {
        const written = new TextDecoder().decode(example.get('subject.yaml'));
        return withFile('subject.yaml', written.slice(0, written.indexOf('concepts:')));
      },
      [f('schema', 'subject.yaml', 'subject example-subject', 'concepts', 'a value of type array', 'nothing')],
    ],
    [
      'a concept declared twice',
      () => edited('subject.yaml', '  - { id: forluster, name: Förluster }\n', '  - { id: forluster, name: Förluster }\n  - { id: forluster, name: Värmeförluster }\n'),
      [
        mismatch('subject.en.yaml', 'subject example-subject', 'concepts', '["energi","effekt","si-prefix","energibalans","forluster","forluster"]', '["energi","effekt","si-prefix","energibalans","forluster"]'),
        f('duplicate-item', 'subject.yaml', 'subject example-subject', 'concepts[5].id', 'each concept declared once', '"forluster"'),
      ],
    ],
    [
      'areas that require each other',
      () => edited('areas/grunder/area.yaml', 'requires: []', 'requires: [fordjupning]'),
      [f('requires-cycle', 'areas/grunder/area.yaml', 'area grunder', 'requires', 'requirements that do not lead back to this area', 'fordjupning → grunder → fordjupning')],
    ],
    [
      'a YAML syntax error',
      () => edited('areas/grunder/area.yaml', 'title: Grunder', 'title: [Grunder'),
      [f('invalid-yaml', 'areas/grunder/area.yaml', null, 'line 3', 'valid YAML', 'Flow sequence in block collection must be sufficiently indented and end with a ] at line 3, column 1:')],
    ],
    [
      'a file the format does not describe',
      () => withFile('areas/grunder/notes.txt', 'stray'),
      [f('unexpected-file', 'areas/grunder/notes.txt', null, '', 'a file the pack format describes, at the place it describes', '"areas/grunder/notes.txt"')],
    ],
    [
      'an id that differs from its folder',
      () => edited('areas/fordjupning/area.yaml', 'id: fordjupning', 'id: fordjupning-2'),
      [
        f('id-mismatch', 'areas/fordjupning/area.yaml', null, 'id', '"fordjupning", the same as the folder name', '"fordjupning-2"'),
        f('area-not-in-path', 'areas/fordjupning-2/area.yaml', 'area fordjupning-2', 'id', 'an area listed under "areas" in subject.yaml', '"fordjupning-2"'),
        f('unknown-area', 'subject.en.yaml', 'subject example-subject', 'areas[1]', 'the id of an area in this pack', '"fordjupning"'),
        f('unknown-area', 'subject.yaml', 'subject example-subject', 'areas[1]', 'the id of an area in this pack', '"fordjupning"'),
      ],
    ],
    [
      'a file stating its own language',
      () => edited('areas/grunder/area.yaml', 'id: grunder', 'id: grunder\nlanguage: sv'),
      [f('derived-field', 'areas/grunder/area.yaml', null, 'language', 'no "language" field: the language is the file name suffix, or the default language without one', '"sv"')],
    ],
    [
      'a file that is not UTF-8',
      () => withFile('sources/extra.md', new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe])),
      [f('not-utf8', 'sources/extra.md', null, '', 'text encoded as UTF-8', 'bytes that are not UTF-8')],
    ],
    [
      'a pack without subject.yaml',
      () => without('subject.yaml'),
      [f('missing-file', 'subject.yaml', null, '', 'a subject.yaml at the root of the pack', 'no such file')],
    ],
  ];

  it.each(cases)('%s', (_name, broken, expected) => {
    // Exactly these faults and no others; the cases list them in reading order, the checker sorts them.
    expect(faultsOf(broken())).toEqual(sortFaults(expected));
  });
});

describe('checkPack on JSON', () => {
  it('names the file an item would live in, though no files were sent', () => {
    const decoded = decodePack(example).pack;
    const questions = decoded['questions'];
    if (!Array.isArray(questions)) {
      throw new Error('decoded pack has no questions');
    }
    const broken = { ...decoded, questions: questions.map((q: unknown, i) => (i === 0 ? { ...(q as object), answer: 42 } : q)) };

    const result = checkPack(broken);

    expect(result).toEqual({
      ok: false,
      error: [f('schema', `${LESSON_3}/questions.yaml`, 'question vagar-ut', 'answer', 'a value of type array', '42')],
    });
  });

  it('rejects a format version it does not know', () => {
    expect(checkPack({ ...decodePack(example).pack, formatVersion: 2 })).toEqual({
      ok: false,
      error: [f('schema', 'subject.yaml', null, 'formatVersion', '1', '2')],
    });
  });
});
