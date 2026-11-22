/**
 * A subject by id, unless it has been removed. Removing a subject retires its
 * own entry and keeps everything else, so a subject is live while its entry in
 * any language is; every read of a subject goes through this, so a removed one
 * reads as missing everywhere rather than half there.
 */
export const LIVE_SUBJECT = `SELECT s.default_language, s.format_version
   FROM catalogue.subject s
  WHERE s.id = $1
    AND EXISTS (SELECT 1 FROM catalogue.entry e WHERE e.subject_id = s.id AND e.kind = 'subject' AND e.retired_at IS NULL)`;
