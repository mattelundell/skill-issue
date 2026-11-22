import type { SectionKind, SubjectOutline } from '@skill-issue/contract';

/** A section's key: its kind and the id of the area or lesson it belongs to, which may share an id. */
export const sectionKey = (kind: SectionKind, itemId: string): string => `${kind}/${itemId}`;

/** One place to write in a notebook, whether or not anything is written there. */
export interface Place {
  readonly key: string;
  readonly kind: SectionKind;
  readonly itemId: string;
  /** The lesson's title; undefined for an area's own section, and for a lesson the subject no longer holds. */
  readonly title: string | undefined;
}

/** An area of the notebook: the area's own section, then a section for each of its lessons. */
export interface Shelf {
  /** Undefined for the shelf of lessons the subject no longer holds. */
  readonly areaId: string | undefined;
  readonly title: string;
  readonly places: readonly Place[];
}

/**
 * The notebook laid out the way the subject is: each area with its own
 * section first and then its lessons', in the order of the path. A section
 * written on a lesson the subject no longer holds comes last, on a shelf of its
 * own, since the learner wrote it.
 */
export function shelves(subject: SubjectOutline, written: Iterable<string>, goneTitle: string): readonly Shelf[] {
  const laid: Shelf[] = subject.areas.map((area) => ({
    areaId: area.id,
    title: area.title,
    places: [
      { key: sectionKey('area', area.id), kind: 'area', itemId: area.id, title: undefined },
      ...area.lessons.map((lesson) => ({ key: sectionKey('lesson', lesson.id), kind: 'lesson' as const, itemId: lesson.id, title: lesson.title })),
    ],
  }));
  const held = new Set(laid.flatMap((shelf) => shelf.places.map((place) => place.key)));
  const gone = [...written]
    .filter((key) => !held.has(key))
    .toSorted()
    .map((key): Place => {
      const [kind, itemId = ''] = key.split('/');
      return { key, kind: kind === 'area' ? 'area' : 'lesson', itemId, title: undefined };
    });
  return gone.length === 0 ? laid : [...laid, { areaId: undefined, title: goneTitle, places: gone }];
}

/** The area a lesson is on, as the subject now stands. */
export function areaOf(subject: SubjectOutline, lessonId: string): string | undefined {
  return subject.areas.find((area) => area.lessons.some((lesson) => lesson.id === lessonId))?.id;
}
