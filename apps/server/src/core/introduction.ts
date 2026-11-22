import { checkPackFiles, readFolder } from '@skill-issue/pack';
import type { Catalogue } from './catalogue/catalogue.js';
import type { Db } from './db.js';
import { describeThrown, log } from './log.js';

export type Introduced = 'loaded' | 'not-empty' | 'failed';

/**
 * Loads the introduction that ships with the application into an installation
 * that holds no subject yet, so a new learner's first page is the introduction
 * rather than an empty list and a command. An installation that holds any
 * subject is left alone — the introduction itself included, so a restart
 * loads nothing again. An introduction that cannot be read or does not check
 * is logged, and the application starts without it.
 */
export async function introduce(db: Db, catalogue: Catalogue, folder: string): Promise<Introduced> {
  try {
    const held = await db.query('SELECT EXISTS (SELECT 1 FROM catalogue.subject) AS held');
    if (held[0]?.['held'] === true) {
      return 'not-empty';
    }
    const files = await readFolder(folder);
    if (!files.ok) {
      log.error('introduction.unreadable', { folder, reason: JSON.stringify(files.error) });
      return 'failed';
    }
    const pack = checkPackFiles(files.value);
    if (!pack.ok) {
      log.error('introduction.invalid', { folder, faults: pack.error.length });
      return 'failed';
    }
    const loaded = await catalogue.load(pack.value, { dryRun: false });
    log.info('introduction.loaded', { subject: loaded.subject });
    return 'loaded';
  } catch (thrown) {
    log.error('introduction.failed', { folder, reason: describeThrown(thrown) });
    return 'failed';
  }
}
