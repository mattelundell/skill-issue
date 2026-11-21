import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  FORMAT_VERSION,
  ItemKindSchema,
  PackSchema,
  type ItemKind,
  type ItemRef,
  type LoadResult,
  type Pack,
  type SubjectSummary,
} from '@skill-issue/contract';
import type { Db, Row } from '../db.js';

/** The catalogue as modules see it: the only way subject material is stored or read. */
export interface Catalogue {
  /** Stores a checked pack as the current state of its subject, or only reports what would change. */
  load(pack: Pack, options: { readonly dryRun: boolean }): Promise<LoadResult>;
  /** The subject's current items as a pack, or undefined when there is no such subject. */
  exportPack(subjectId: string): Promise<Pack | undefined>;
  listSubjects(): Promise<readonly SubjectSummary[]>;
}

/** The pack's collections of items and the kind each holds. Assets are kept apart: they have no revisions. */
const COLLECTIONS = [
  ['subject', 'subject'],
  ['sources', 'source'],
  ['glossary', 'glossary-term'],
  ['areas', 'area'],
  ['lessons', 'lesson'],
  ['questions', 'question'],
] as const satisfies readonly (readonly [keyof Pack, ItemKind])[];

type ItemCollection = (typeof COLLECTIONS)[number][0];

const COLLECTION_OF: ReadonlyMap<ItemKind, ItemCollection> = new Map(COLLECTIONS.map(([collection, kind]) => [kind, collection]));

/** The title and summary of a stored subject entry. */
const SubjectTextSchema = z.object({ title: z.string(), summary: z.string() });

/** JSON with object keys sorted, so equal content always gives the same digest. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const digestOf = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');

interface Placement {
  readonly parentKind: string | null;
  readonly parentId: string | null;
  readonly position: number;
}

interface WantedEntry {
  readonly kind: ItemKind;
  readonly id: string;
  readonly language: string;
  readonly body: Record<string, unknown>;
  readonly digest: string;
}

const entryKey = (kind: string, id: string, language: string): string => `${kind}\u0000${id}\u0000${language}`;

/** Every entry in the pack, keyed by kind, id and language, with the language moved out of the body. */
function entriesOf(pack: Pack): Map<string, WantedEntry> {
  const entries = new Map<string, WantedEntry>();
  for (const [collection, kind] of COLLECTIONS) {
    const items: readonly { readonly id: string; readonly language: string }[] = pack[collection];
    for (const { language, ...body } of items) {
      entries.set(entryKey(kind, body.id, language), { kind, id: body.id, language, body, digest: digestOf(body) });
    }
  }
  return entries;
}

/** Where each item sits, taken from the default language: the subject's areas, each area's lessons, each lesson's bank. */
function placementsOf(pack: Pack): Map<string, Placement> {
  const subject = pack.subject.find((entry) => entry.language === entry.defaultLanguage) ?? pack.subject[0];
  const language = subject?.defaultLanguage;
  const subjectId = subject?.id ?? '';
  const placements = new Map<string, Placement>();
  const place = (kind: string, id: string, parentKind: string | null, parentId: string | null, position: number): void => {
    placements.set(`${kind}\u0000${id}`, { parentKind, parentId, position });
  };
  place('subject', subjectId, null, null, 0);
  for (const [position, area] of (subject?.areas ?? []).entries()) {
    place('area', area, 'subject', subjectId, position);
  }
  const original = <T extends { readonly language: string }>(items: readonly T[]): T[] => items.filter((item) => item.language === language);
  for (const area of original(pack.areas)) {
    for (const [position, lesson] of area.lessons.entries()) {
      place('lesson', lesson, 'area', area.id, position);
    }
  }
  const perLesson = new Map<string, number>();
  for (const question of original(pack.questions)) {
    const position = perLesson.get(question.lesson) ?? 0;
    perLesson.set(question.lesson, position + 1);
    place('question', question.id, 'lesson', question.lesson, position);
  }
  for (const [position, source] of original(pack.sources).entries()) {
    place('source', source.id, 'subject', subjectId, position);
  }
  for (const [position, term] of original(pack.glossary).entries()) {
    place('glossary-term', term.id, 'subject', subjectId, position);
  }
  return placements;
}

const text = (row: Row, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new TypeError(`catalogue column ${column} is not text`);
  }
  return value;
};

const ref = ({ kind, id, language }: { readonly kind: ItemKind; readonly id: string; readonly language: string }): ItemRef => ({ kind, id, language });
const assetRef = (path: string): ItemRef => ({ kind: 'asset', id: path, language: null });

const byRef = (a: ItemRef, b: ItemRef): number => {
  const left = `${a.kind}\u0000${a.id}\u0000${a.language ?? ''}`;
  const right = `${b.kind}\u0000${b.id}\u0000${b.language ?? ''}`;
  return left < right ? -1 : left > right ? 1 : 0;
};

export function createCatalogue(db: Db): Catalogue {
  const load = async (pack: Pack, { dryRun }: { readonly dryRun: boolean }): Promise<LoadResult> =>
    db.transaction(async (tx) => {
      const subject = pack.subject.find((entry) => entry.language === entry.defaultLanguage);
      if (subject === undefined) {
        throw new Error('a checked pack has a subject entry in its default language');
      }
      const subjectId = subject.id;
      // Two loads of one subject at once would race for the same revision numbers.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`catalogue:${subjectId}`]);

      const existing = await tx.query('SELECT 1 FROM catalogue.subject WHERE id = $1', [subjectId]);
      const created = existing.length === 0;
      const currentRows = await tx.query(
        `SELECT e.kind, e.id, e.language, e.retired_at IS NOT NULL AS retired, r.digest
           FROM catalogue.entry e
           JOIN catalogue.revision r USING (subject_id, kind, id, language)
          WHERE e.subject_id = $1 AND r.revision = e.current_revision`,
        [subjectId],
      );
      const current = new Map(
        currentRows.map((row) => [
          entryKey(text(row, 'kind'), text(row, 'id'), text(row, 'language')),
          {
            digest: text(row, 'digest'),
            retired: row['retired'] === true,
            kind: ItemKindSchema.parse(row['kind']),
            id: text(row, 'id'),
            language: text(row, 'language'),
          },
        ]),
      );
      const wanted = entriesOf(pack);

      const added: WantedEntry[] = [];
      const changed: WantedEntry[] = [];
      let unchanged = 0;
      for (const [key, entry] of wanted) {
        const now = current.get(key);
        if (now === undefined || now.retired) {
          added.push(entry);
        } else if (now.digest === entry.digest) {
          unchanged += 1;
        } else {
          changed.push(entry);
        }
      }
      const retired = [...current].filter(([key, now]) => !now.retired && !wanted.has(key)).map(([, now]) => now);

      const assetRows = await tx.query('SELECT path, digest FROM catalogue.asset WHERE subject_id = $1', [subjectId]);
      const currentAssets = new Map(assetRows.map((row) => [text(row, 'path'), text(row, 'digest')]));
      const wantedAssets = new Map(pack.assets.map((asset) => [asset.path, { ...asset, digest: digestOf(asset) }]));
      const addedAssets = [...wantedAssets.values()].filter((asset) => !currentAssets.has(asset.path));
      const changedAssets = [...wantedAssets.values()].filter((asset) => {
        const digest = currentAssets.get(asset.path);
        return digest !== undefined && digest !== asset.digest;
      });
      const retiredAssets = [...currentAssets.keys()].filter((path) => !wantedAssets.has(path));
      unchanged += wantedAssets.size - addedAssets.length - changedAssets.length;

      const result = {
        subject: subjectId,
        created,
        added: [...added.map(ref), ...addedAssets.map((asset) => assetRef(asset.path))].toSorted(byRef),
        changed: [...changed.map(ref), ...changedAssets.map((asset) => assetRef(asset.path))].toSorted(byRef),
        retired: [...retired.map(ref), ...retiredAssets.map(assetRef)].toSorted(byRef),
        unchanged,
      };
      const nothingToDo = result.added.length + result.changed.length + result.retired.length === 0;
      if (dryRun || nothingToDo) {
        return { ...result, stored: false };
      }

      await tx.query(
        `INSERT INTO catalogue.subject (id, default_language, format_version) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET default_language = EXCLUDED.default_language,
                                        format_version = EXCLUDED.format_version,
                                        updated_at = now()`,
        [subjectId, subject.defaultLanguage, pack.formatVersion],
      );
      for (const [key, placement] of placementsOf(pack)) {
        const [kind, id] = key.split('\u0000');
        await tx.query(
          `INSERT INTO catalogue.item (subject_id, kind, id, parent_kind, parent_id, position) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (subject_id, kind, id) DO UPDATE SET parent_kind = EXCLUDED.parent_kind,
                                                            parent_id = EXCLUDED.parent_id,
                                                            position = EXCLUDED.position`,
          [subjectId, kind, id, placement.parentKind, placement.parentId, placement.position],
        );
      }
      for (const entry of [...added, ...changed]) {
        const latest = await tx.query(
          'SELECT coalesce(max(revision), 0) + 1 AS next FROM catalogue.revision WHERE subject_id = $1 AND kind = $2 AND id = $3 AND language = $4',
          [subjectId, entry.kind, entry.id, entry.language],
        );
        const revision = Number(latest[0]?.['next'] ?? 1);
        await tx.query(
          `INSERT INTO catalogue.entry (subject_id, kind, id, language, current_revision, retired_at) VALUES ($1, $2, $3, $4, $5, NULL)
           ON CONFLICT (subject_id, kind, id, language) DO UPDATE SET current_revision = EXCLUDED.current_revision, retired_at = NULL`,
          [subjectId, entry.kind, entry.id, entry.language, revision],
        );
        await tx.query(
          'INSERT INTO catalogue.revision (subject_id, kind, id, language, revision, body, digest) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [subjectId, entry.kind, entry.id, entry.language, revision, JSON.stringify(entry.body), entry.digest],
        );
      }
      for (const entry of retired) {
        await tx.query(
          'UPDATE catalogue.entry SET retired_at = now() WHERE subject_id = $1 AND kind = $2 AND id = $3 AND language = $4',
          [subjectId, entry.kind, entry.id, entry.language],
        );
      }
      for (const asset of [...addedAssets, ...changedAssets]) {
        await tx.query(
          `INSERT INTO catalogue.asset (subject_id, path, media_type, data, digest) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (subject_id, path) DO UPDATE SET media_type = EXCLUDED.media_type, data = EXCLUDED.data, digest = EXCLUDED.digest`,
          [subjectId, asset.path, asset.mediaType, Buffer.from(asset.data, 'base64'), asset.digest],
        );
      }
      for (const path of retiredAssets) {
        await tx.query('DELETE FROM catalogue.asset WHERE subject_id = $1 AND path = $2', [subjectId, path]);
      }
      return { ...result, stored: true };
    });

  const exportPack = async (subjectId: string): Promise<Pack | undefined> => {
    const subjects = await db.query('SELECT default_language, format_version FROM catalogue.subject WHERE id = $1', [subjectId]);
    const subject = subjects[0];
    if (subject === undefined) {
      return undefined;
    }
    const defaultLanguage = text(subject, 'default_language');
    const rows = await db.query(
      `SELECT e.kind, e.language, r.body
         FROM catalogue.entry e
         JOIN catalogue.revision r USING (subject_id, kind, id, language)
         JOIN catalogue.item i USING (subject_id, kind, id)
        WHERE e.subject_id = $1 AND r.revision = e.current_revision AND e.retired_at IS NULL
        ORDER BY i.kind, i.parent_id NULLS FIRST, i.position, (e.language = $2) DESC, e.language`,
      [subjectId, defaultLanguage],
    );
    const collections: Record<ItemCollection, unknown[]> = { subject: [], sources: [], glossary: [], areas: [], lessons: [], questions: [] };
    for (const row of rows) {
      const collection = COLLECTION_OF.get(ItemKindSchema.parse(row['kind']));
      const body = row['body'];
      if (collection === undefined || typeof body !== 'object' || body === null) {
        throw new TypeError(`catalogue entry of kind ${String(row['kind'])} cannot be exported`);
      }
      collections[collection].push({ ...body, language: text(row, 'language') });
    }
    const assets = await db.query('SELECT path, media_type, data FROM catalogue.asset WHERE subject_id = $1 ORDER BY path', [subjectId]);
    // Parsed rather than trusted: what was stored under an earlier format must still be a valid pack.
    return PackSchema.parse({
      formatVersion: FORMAT_VERSION,
      ...collections,
      assets: assets.map((row) => {
        const data = row['data'];
        if (!(data instanceof Buffer)) {
          throw new TypeError('catalogue asset data is not bytes');
        }
        return { path: text(row, 'path'), mediaType: text(row, 'media_type'), data: data.toString('base64') };
      }),
    });
  };

  const listSubjects = async (): Promise<readonly SubjectSummary[]> => {
    const rows = await db.query(
      `SELECT s.id, s.default_language,
              array_agg(e.language ORDER BY e.language) AS languages,
              (array_agg(r.body ORDER BY (e.language = s.default_language) DESC))[1] AS body
         FROM catalogue.subject s
         JOIN catalogue.entry e ON e.subject_id = s.id AND e.kind = 'subject' AND e.retired_at IS NULL
         JOIN catalogue.revision r ON r.subject_id = e.subject_id AND r.kind = e.kind AND r.id = e.id
                                  AND r.language = e.language AND r.revision = e.current_revision
        GROUP BY s.id, s.default_language
        ORDER BY s.id`,
    );
    return rows.map((row) => {
      const { title, summary } = SubjectTextSchema.parse(row['body']);
      return {
        id: text(row, 'id'),
        defaultLanguage: text(row, 'default_language'),
        languages: z.array(z.string()).parse(row['languages']),
        title,
        summary,
      };
    });
  };

  return { load, exportPack, listSubjects };
}
