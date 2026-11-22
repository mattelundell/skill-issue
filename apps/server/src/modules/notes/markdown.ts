import { headingsBelow, type NotebookSection, type SubjectOutline } from '@skill-issue/contract';

export { headingsBelow };

export const EXPORT_LANGUAGES = ['sv', 'en'] as const;
export type ExportLanguage = (typeof EXPORT_LANGUAGES)[number];

/** The export's own words, per interface language; the subject's material comes in its content language. */
const MESSAGES: Readonly<Record<ExportLanguage, Readonly<Record<'title' | 'gone' | 'goneFile' | 'goneLesson' | 'none', string>>>> = {
  sv: { title: '{subject} — anteckningar', gone: 'Inte längre i ämnet', goneFile: 'inte-langre-i-amnet', goneLesson: 'Lektionen {id}', none: 'Inga anteckningar än.' },
  en: { title: '{subject} — notes', gone: 'No longer in the subject', goneFile: 'no-longer-in-the-subject', goneLesson: 'Lesson {id}', none: 'No notes yet.' },
};

export const isExportLanguage = (language: string): language is ExportLanguage => Object.hasOwn(MESSAGES, language);

const fill = (template: string, values: Readonly<Record<string, string>>): string => template.replaceAll(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

/** An image link to one of the notebook's own images, as the browser writes it. */
const IMAGE_LINK = /!\[[^\]\n]*\]\(bilder\/(bild-[1-9][0-9]{0,5}\.(?:png|jpg|gif|webp))\)/g;

/** The names of the notebook's images the sections link to, each once, in name order. */
export function imagesReferenced(bodies: readonly string[]): readonly string[] {
  return [...new Set(bodies.flatMap((body) => [...body.matchAll(IMAGE_LINK)].map((match) => match[1] ?? '')))].toSorted();
}

/** A lesson's heading and its section in an area's file; the area's title is level 1 and a lesson's level 2, so a learner's own headings go two below. */
const LESSON_LEVEL = 2;

/** A heading and the section written under it, the learner's own headings moved below the lesson's. */
const block = (level: number, title: string, text: string): string[] => [`${'#'.repeat(level)} ${title}`, '', headingsBelow(text, LESSON_LEVEL), ''];

/**
 * A subject's notebook as Markdown files: one per area with something written,
 * numbered in the order of the path, holding the area's own section under its
 * title and each written lesson's under the lesson's; a README linking them.
 * Sections on lessons the subject no longer holds come last, in a file of their
 * own, since the learner wrote them. Images are linked as `bilder/<name>`, and
 * lie in that folder beside the files.
 */
export function notebookFiles(subject: SubjectOutline, sections: readonly NotebookSection[], language: ExportLanguage): ReadonlyMap<string, string> {
  const words = MESSAGES[language];
  const body = new Map(sections.map((section) => [`${section.kind}/${section.itemId}`, section.body.trim()]));

  const files = new Map<string, string>();
  const contents: string[] = [];
  const add = (name: string, title: string, lines: readonly string[]): void => {
    files.set(name, [`# ${title}`, '', ...lines].join('\n').replace(/\n+$/, '\n'));
    contents.push(`- [${title}](${name})`);
  };

  subject.areas.forEach((area, index) => {
    const own = body.get(`area/${area.id}`);
    const lines = [
      ...(own === undefined ? [] : [headingsBelow(own, LESSON_LEVEL), '']),
      ...area.lessons.flatMap(({ id, title }) => {
        const text = body.get(`lesson/${id}`);
        return text === undefined ? [] : block(LESSON_LEVEL, title, text);
      }),
    ];
    if (lines.length > 0) {
      add(`${String(index + 1).padStart(2, '0')}-${area.id}.md`, area.title, lines);
    }
  });

  const held = new Set(subject.areas.flatMap((area) => [`area/${area.id}`, ...area.lessons.map(({ id }) => `lesson/${id}`)]));
  const gone = sections.filter((section) => section.kind === 'lesson' && !held.has(`lesson/${section.itemId}`)).toSorted((a, b) => (a.itemId < b.itemId ? -1 : 1));
  if (gone.length > 0) {
    add(`99-${words.goneFile}.md`, words.gone, gone.flatMap((section) => block(LESSON_LEVEL, fill(words.goneLesson, { id: section.itemId }), section.body.trim())));
  }

  const title = `# ${fill(words.title, { subject: subject.title })}`;
  const readme = contents.length === 0 ? `${title}\n\n${words.none}\n` : `${title}\n\n${contents.join('\n')}\n`;
  return new Map([['README.md', readme], ...files]);
}
