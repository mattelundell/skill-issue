import { ASSET_MEDIA_TYPES, type ContentFault, type ItemKind, type Pack } from '@skill-issue/contract';
import MarkdownIt from 'markdown-it';
import { describeValue, fault, fileOf, itemLabel, layoutOf, type Layout } from './location.js';

/**
 * The rules a pack must keep beyond its schema: every reference resolves,
 * every exam can be drawn, and nothing in it can run or fetch anything.
 * Returns every broken rule, not only the first.
 */
export function ruleFaults(pack: Pack): ContentFault[] {
  return new RuleCheck(pack).run();
}

/** Links may leave the application only for the web or mail; images never do. */
const LINK_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto']);

const markdown = new MarkdownIt({ html: true, linkify: false });
// Every link is tokenised and judged here, rather than silently turned into text.
markdown.validateLink = () => true;
markdown.normalizeLink = (url) => url;

interface MarkdownToken {
  readonly type: string;
  readonly content: string;
  readonly children: readonly MarkdownToken[] | null;
  attrGet(name: string): string | number | null;
}

function* tokensOf(tokens: readonly MarkdownToken[]): Generator<MarkdownToken> {
  for (const token of tokens) {
    yield token;
    if (token.children !== null) {
      yield* tokensOf(token.children);
    }
  }
}

const MEDIA_TYPE_OF_EXTENSION: ReadonlyMap<string, string> = new Map(Object.entries(ASSET_MEDIA_TYPES));

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

class RuleCheck {
  private readonly faults: ContentFault[] = [];
  private readonly layout: Layout;
  private readonly defaultLanguage: string;
  private readonly sourceIds: ReadonlySet<string>;
  private readonly areaIds: ReadonlySet<string>;
  private readonly lessonIds: ReadonlySet<string>;
  private readonly assetPaths: ReadonlySet<string>;
  /** The questions of each lesson's bank, in the default language. */
  private readonly bank: ReadonlyMap<string, readonly string[]>;
  private readonly questionLesson: ReadonlyMap<string, string>;
  private readonly concepts: ReadonlySet<string>;

  constructor(private readonly pack: Pack) {
    this.layout = layoutOf(pack);
    this.defaultLanguage = pack.subject[0]?.defaultLanguage ?? '';
    const original = <T extends { readonly language: string }>(items: readonly T[]): T[] =>
      items.filter((item) => item.language === this.defaultLanguage);
    this.sourceIds = new Set(pack.sources.map((source) => source.id));
    this.areaIds = new Set(pack.areas.map((area) => area.id));
    this.lessonIds = new Set(pack.lessons.map((lesson) => lesson.id));
    this.assetPaths = new Set(pack.assets.map((asset) => asset.path));
    const bank = new Map<string, string[]>();
    const questionLesson = new Map<string, string>();
    for (const question of original(pack.questions)) {
      bank.set(question.lesson, [...(bank.get(question.lesson) ?? []), question.id]);
      questionLesson.set(question.id, question.lesson);
    }
    this.bank = bank;
    this.questionLesson = questionLesson;
    this.concepts = new Set(original(pack.lessons).flatMap((lesson) => lesson.concepts));
  }

  run(): ContentFault[] {
    this.checkSubject();
    this.checkTranslations();
    this.checkAreas();
    this.checkLessons();
    this.checkQuestions();
    this.checkGlossary();
    this.checkSources();
    this.checkAssets();
    return this.faults;
  }

  private add(kind: ItemKind, item: unknown, code: string, field: string, expected: string, found: string): void {
    this.faults.push(fault(code, fileOf(kind, item, this.layout), itemLabel(kind, item), field, expected, found));
  }

  /** Each entry of a list of references must name an existing item, and only once. */
  private references(
    kind: ItemKind,
    item: unknown,
    field: string,
    ids: readonly string[],
    known: ReadonlySet<string>,
    code: string,
    what: string,
  ): void {
    const seen = new Set<string>();
    for (const [index, id] of ids.entries()) {
      if (!known.has(id)) {
        this.add(kind, item, code, `${field}[${index}]`, `the id of ${what} in this pack`, describeValue(id));
      }
      if (seen.has(id)) {
        this.add(kind, item, 'duplicate-reference', `${field}[${index}]`, `each ${what} named once`, describeValue(id));
      }
      seen.add(id);
    }
  }

  private checkSubject(): void {
    const [first, ...others] = this.pack.subject;
    if (first === undefined) {
      return;
    }
    if (!this.pack.subject.some((entry) => entry.language === first.defaultLanguage)) {
      this.add('subject', { ...first, language: first.defaultLanguage }, 'missing-original', 'language', `a subject entry in the default language ${describeValue(first.defaultLanguage)}`, 'none');
    }
    for (const entry of others) {
      for (const field of ['id', 'defaultLanguage'] as const) {
        if (entry[field] !== first[field]) {
          this.add('subject', entry, 'translation-mismatch', field, describeValue(first[field]), describeValue(entry[field]));
        }
      }
      if (entry.areas.join('\n') !== first.areas.join('\n')) {
        this.add('subject', entry, 'translation-mismatch', 'areas', describeValue(first.areas), describeValue(entry.areas));
      }
    }
    for (const entry of this.pack.subject) {
      this.references('subject', entry, 'areas', entry.areas, this.areaIds, 'unknown-area', 'an area');
    }
  }

  /** Each item exists once per language, and a translation always has an original. */
  private checkTranslations(): void {
    const kinds: readonly [ItemKind, readonly { readonly id: string; readonly language: string }[]][] = [
      ['subject', this.pack.subject],
      ['source', this.pack.sources],
      ['glossary-term', this.pack.glossary],
      ['area', this.pack.areas],
      ['lesson', this.pack.lessons],
      ['question', this.pack.questions],
    ];
    for (const [kind, items] of kinds) {
      const seen = new Set<string>();
      const originals = new Set(items.filter((item) => item.language === this.defaultLanguage).map((item) => item.id));
      for (const item of items) {
        const key = `${item.id}\n${item.language}`;
        if (seen.has(key)) {
          this.add(kind, item, 'duplicate-item', 'id', `one ${kind} with this id in each language`, describeValue(item.id));
        }
        seen.add(key);
        if (item.language !== this.defaultLanguage && !originals.has(item.id)) {
          this.add(kind, item, 'missing-original', 'language', `the same ${kind} also in the default language ${describeValue(this.defaultLanguage)}`, describeValue(item.language));
        }
      }
      if (kind === 'subject') {
        // The subject entry's own fields are checked with the subject.
        continue;
      }
      const original = new Map(items.filter((item) => item.language === this.defaultLanguage).map((item) => [item.id, item]));
      for (const item of items) {
        const source = original.get(item.id);
        if (item.language === this.defaultLanguage || source === undefined) {
          continue;
        }
        const theirs = new Map(structureOf(source));
        for (const [field, value] of structureOf(item)) {
          const expected = theirs.get(field);
          if (theirs.has(field) && JSON.stringify(expected) !== JSON.stringify(value)) {
            this.add(kind, item, 'translation-mismatch', field, `the same as in the default language: ${describeValue(expected)}`, describeValue(value));
          }
        }
      }
    }
  }

  private checkAreas(): void {
    const inPath = new Set(this.pack.subject.flatMap((entry) => entry.areas));
    const listedIn = new Map<string, string>();
    for (const area of this.pack.areas) {
      if (!inPath.has(area.id)) {
        this.add('area', area, 'area-not-in-path', 'id', 'an area listed under "areas" in subject.yaml', describeValue(area.id));
      }
      this.references('area', area, 'requires', area.requires, this.areaIds, 'unknown-area', 'an area');
      if (area.requires.includes(area.id)) {
        this.add('area', area, 'requires-cycle', 'requires', 'areas other than this one', describeValue(area.id));
      }
      this.references('area', area, 'lessons', area.lessons, this.lessonIds, 'unknown-lesson', 'a lesson');
      if (area.language !== this.defaultLanguage) {
        continue;
      }
      for (const [index, lesson] of area.lessons.entries()) {
        const other = listedIn.get(lesson);
        if (other !== undefined && other !== area.id) {
          this.add('area', area, 'lesson-in-two-areas', `lessons[${index}]`, `a lesson listed in one area only; it is also in ${describeValue(other)}`, describeValue(lesson));
        }
        listedIn.set(lesson, area.id);
      }
      const drawable = area.lessons.reduce((total, lesson) => total + (this.bank.get(lesson)?.length ?? 0), 0);
      if (area.exam.questions > drawable) {
        this.add('area', area, 'exam-larger-than-bank', 'exam.questions', `at most ${drawable}, the questions in the banks of this area's lessons`, describeValue(area.exam.questions));
      }
    }
    for (const lesson of this.pack.lessons) {
      if (lesson.language === this.defaultLanguage && !listedIn.has(lesson.id)) {
        this.add('lesson', lesson, 'lesson-not-in-area', 'id', 'a lesson listed under "lessons" in an area.yaml', describeValue(lesson.id));
      }
    }
    this.checkRequiresCycles();
  }

  /** A cycle longer than one area; an area requiring itself is reported where it is checked. */
  private checkRequiresCycles(): void {
    const requires = new Map(
      this.pack.areas.filter((area) => area.language === this.defaultLanguage).map((area) => [area.id, area.requires] as const),
    );
    const reported = new Set<string>();
    const visit = (area: string, trail: readonly string[]): void => {
      for (const next of requires.get(area) ?? []) {
        if (next === area) {
          continue;
        }
        const start = trail.indexOf(next);
        if (start !== -1) {
          const cycle = [...trail.slice(start), next];
          const key = [...new Set(cycle)].toSorted().join(',');
          const item = this.pack.areas.find((candidate) => candidate.id === area && candidate.language === this.defaultLanguage);
          if (!reported.has(key) && item !== undefined) {
            reported.add(key);
            this.add('area', item, 'requires-cycle', 'requires', 'requirements that do not lead back to this area', cycle.join(' → '));
          }
          continue;
        }
        visit(next, [...trail, next]);
      }
    };
    for (const area of requires.keys()) {
      visit(area, [area]);
    }
  }

  private checkLessons(): void {
    for (const lesson of this.pack.lessons) {
      this.references('lesson', lesson, 'sources', lesson.sources, this.sourceIds, 'unknown-source', 'a source');
      this.references('lesson', lesson, 'concepts', lesson.concepts, this.concepts, 'unknown-concept', 'a concept');
      const own = this.bank.get(lesson.id) ?? [];
      for (const [stepIndex, step] of lesson.steps.entries()) {
        switch (step.type) {
          case 'text':
          case 'example':
            this.markdown('lesson', lesson, `steps[${stepIndex}].body`, step.body);
            break;
          case 'check':
            for (const [index, question] of step.questions.entries()) {
              const field = `steps[${stepIndex}].questions[${index}]`;
              const owner = this.questionLesson.get(question);
              if (owner === undefined) {
                this.add('lesson', lesson, 'unknown-question', field, "the id of a question in this lesson's questions.yaml", describeValue(question));
              } else if (owner !== lesson.id) {
                this.add('lesson', lesson, 'question-not-in-bank', field, `a question from this lesson's own bank; it belongs to ${describeValue(owner)}`, describeValue(question));
              }
            }
            break;
          default: {
            const unhandled: never = step;
            throw new Error(`Unhandled step ${JSON.stringify(unhandled)}`);
          }
        }
      }
      if (lesson.language === this.defaultLanguage && lesson.exam.questions > own.length) {
        this.add('lesson', lesson, 'exam-larger-than-bank', 'exam.questions', `at most ${own.length}, the questions in this lesson's bank`, describeValue(lesson.exam.questions));
      }
    }
  }

  private checkQuestions(): void {
    for (const question of this.pack.questions) {
      if (!this.lessonIds.has(question.lesson)) {
        this.add('question', question, 'unknown-lesson', 'lesson', 'the id of a lesson in this pack', describeValue(question.lesson));
      }
      this.references('question', question, 'sources', question.sources, this.sourceIds, 'unknown-source', 'a source');
      this.references('question', question, 'concepts', question.concepts, this.concepts, 'unknown-concept', 'a concept a lesson lists under "concepts"');
      this.markdown('question', question, 'prompt', question.prompt);
      this.markdown('question', question, 'explanation', question.explanation);
      switch (question.type) {
        case 'single-choice':
        case 'multiple-choice': {
          const optionIds = question.options.map((option) => option.id);
          this.distinct('question', question, 'options', optionIds.map((id, index) => [`options[${index}].id`, id]), 'duplicate-option');
          const answers = question.type === 'single-choice' ? [['answer', question.answer] as const] : question.answer.map((id, index) => [`answer[${index}]`, id] as const);
          for (const [field, id] of answers) {
            if (!optionIds.includes(id)) {
              this.add('question', question, 'unknown-option', field, `one of the option ids ${describeValue(optionIds)}`, describeValue(id));
            }
          }
          if (question.type === 'multiple-choice') {
            this.distinct('question', question, 'answer', question.answer.map((id, index) => [`answer[${index}]`, id]), 'duplicate-reference');
          }
          break;
        }
        case 'ordering':
          this.distinct('question', question, 'items', question.items.map((text, index) => [`items[${index}]`, text]), 'duplicate-entry');
          break;
        case 'matching':
          this.distinct('question', question, 'pairs', question.pairs.map((pair, index) => [`pairs[${index}].left`, pair.left]), 'duplicate-entry');
          this.distinct('question', question, 'pairs', question.pairs.map((pair, index) => [`pairs[${index}].right`, pair.right]), 'duplicate-entry');
          break;
        case 'free-recall':
          this.markdown('question', question, 'answer', question.answer);
          break;
        case 'true-false':
        case 'numeric':
        case 'short-text':
          break;
        default: {
          const unhandled: never = question;
          throw new Error(`Unhandled question ${JSON.stringify(unhandled)}`);
        }
      }
    }
  }

  /** Entries that must differ, or the learner could not tell them apart. */
  private distinct(kind: ItemKind, item: unknown, what: string, entries: readonly (readonly [string, string])[], code: string): void {
    const seen = new Set<string>();
    for (const [field, value] of entries) {
      if (seen.has(value)) {
        this.add(kind, item, code, field, `each entry of ${what} different from the others`, describeValue(value));
      }
      seen.add(value);
    }
  }

  private checkGlossary(): void {
    for (const term of this.pack.glossary) {
      this.references('glossary-term', term, 'sources', term.sources, this.sourceIds, 'unknown-source', 'a source');
      this.markdown('glossary-term', term, 'definition', term.definition);
    }
  }

  private checkSources(): void {
    for (const source of this.pack.sources) {
      this.markdown('source', source, 'body', source.body);
    }
  }

  private checkAssets(): void {
    const seen = new Set<string>();
    for (const asset of this.pack.assets) {
      if (seen.has(asset.path)) {
        this.add('asset', asset, 'duplicate-item', 'path', 'each asset path once', describeValue(asset.path));
      }
      seen.add(asset.path);
      const extension = asset.path.slice(asset.path.lastIndexOf('.') + 1).toLowerCase();
      const mediaType = MEDIA_TYPE_OF_EXTENSION.get(extension);
      if (mediaType === undefined) {
        this.add('asset', asset, 'unsupported-asset', 'path', `a file ending in ${Object.keys(ASSET_MEDIA_TYPES).map((e) => `.${e}`).join(', ')}`, describeValue(asset.path));
      } else if (mediaType !== asset.mediaType) {
        this.add('asset', asset, 'asset-type-mismatch', 'mediaType', describeValue(mediaType), describeValue(asset.mediaType));
      }
    }
  }

  /** No raw HTML; images only from the pack's own assets; links only to the web, mail or the pack. */
  private markdown(kind: ItemKind, item: unknown, field: string, text: string): void {
    for (const token of tokensOf(markdown.parse(text, {}))) {
      if (token.type === 'html_block' || token.type === 'html_inline') {
        this.add(kind, item, 'raw-html', field, 'Markdown without HTML tags', describeValue(token.content.trim()));
      } else if (token.type === 'image') {
        this.target(kind, item, field, String(token.attrGet('src') ?? ''), 'image');
      } else if (token.type === 'link_open') {
        this.target(kind, item, field, String(token.attrGet('href') ?? ''), 'link');
      }
    }
  }

  private target(kind: ItemKind, item: unknown, field: string, target: string, what: 'image' | 'link'): void {
    const scheme = SCHEME.exec(target)?.[1]?.toLowerCase();
    if (what === 'link' && (target.startsWith('#') || (scheme !== undefined && LINK_SCHEMES.has(scheme)))) {
      return;
    }
    if (scheme !== undefined || target.startsWith('//')) {
      this.add(kind, item, what === 'image' ? 'remote-image' : 'unsafe-link', field,
        what === 'image' ? 'an image from the pack, as assets/<file>' : 'a link to http, https, mailto or a file in assets/',
        describeValue(target));
      return;
    }
    const relative = target.startsWith('./') ? target.slice(2) : target;
    if (!this.assetPaths.has(relative)) {
      this.add(kind, item, 'unknown-asset', field, 'a file in the pack, as assets/<file>', describeValue(target));
    }
  }
}

/**
 * What a translation must keep from its original: everything but its words.
 * A translation that gave another answer, other option ids, other steps or
 * another exam would grade, schedule and resume differently by language,
 * while progress attaches to the id and not the language. Each entry is a
 * field and its value; a field the original lacks is not compared, so a
 * question translated as another type is named once, by its type.
 */
/** An object's fields by name; nothing for anything else. */
function fieldsOf(value: unknown): ReadonlyMap<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? new Map(Object.entries(value)) : new Map();
}

function structureOf(item: { readonly id: string; readonly language: string }): readonly (readonly [string, unknown])[] {
  const fields: [string, unknown][] = [];
  const read = fieldsOf(item);
  const keep = (...names: readonly string[]): void => {
    for (const name of names) {
      if (read.has(name)) {
        fields.push([name, read.get(name)]);
      }
    }
  };
  const examFields = (): void => {
    if (read.has('exam')) {
      const blueprint = fieldsOf(read.get('exam'));
      fields.push(['exam.questions', blueprint.get('questions')], ['exam.passMark', blueprint.get('passMark')]);
    }
  };
  const list = (name: string): readonly unknown[] => {
    const value = read.get(name);
    return Array.isArray(value) ? value : [];
  };
  if (read.has('body') && read.has('accessed')) {
    // A source: where it came from, not what it is called.
    keep('url', 'accessed', 'kind');
  } else if (read.has('definition')) {
    keep('sources');
  } else if (read.has('steps')) {
    keep('concepts', 'sources');
    examFields();
    const steps = list('steps').map(fieldsOf);
    fields.push(['steps', steps.map((step) => step.get('type'))]);
    for (const [index, step] of steps.entries()) {
      if (step.get('type') === 'check') {
        fields.push([`steps[${String(index)}].questions`, step.get('questions')]);
      }
    }
  } else if (read.has('lessons')) {
    keep('requires', 'lessons');
    examFields();
  } else if (read.has('prompt')) {
    keep('type', 'lesson', 'concepts', 'sources');
    const type = read.get('type');
    const answer = read.get('answer');
    if (type === 'single-choice' || type === 'multiple-choice') {
      fields.push(['options', list('options').map((option) => fieldsOf(option).get('id'))], ['answer', answer]);
    } else if (type === 'true-false') {
      fields.push(['answer', answer]);
    } else if (type === 'numeric') {
      const numeric = fieldsOf(answer);
      fields.push(['answer.value', numeric.get('value')], ['answer.tolerance', numeric.get('tolerance')]);
    } else if (type === 'short-text') {
      keep('caseSensitive');
    } else if (type === 'ordering') {
      fields.push(['items.length', list('items').length]);
    } else if (type === 'matching') {
      fields.push(['pairs.length', list('pairs').length]);
    }
  }
  return fields;
}
