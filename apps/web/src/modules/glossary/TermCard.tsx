import type { GlossaryEntry } from '@skill-issue/contract';
import { Fragment, useCallback } from 'react';
import { useSourceLink } from '../../shell/contributions.js';
import { useI18n } from '../../shell/i18n.js';
import { Markdown } from '../../shell/markdown.js';
import { Link } from '../../shell/router.js';
import { useMessages } from './messages.js';

/** What a marked term opens: the term, its definition, the other names it goes by and the sources it rests on, each linked where a module shows sources. */
export function TermCard({ entry, subjectId }: { readonly entry: GlossaryEntry; readonly subjectId: string }) {
  const { t, tc } = useMessages();
  const { list } = useI18n();
  const sourceLink = useSourceLink();
  const imageText = useCallback((alt: string) => t('image', { alt }), [t]);
  return (
    <div className="term-entry" lang={entry.language}>
      <dfn>{entry.term}</dfn>
      <div role="definition">
        <Markdown className="term-definition" source={entry.definition} subjectId={subjectId} imageText={imageText} />
      </div>
      {entry.alsoKnownAs.length === 0 ? null : <p className="term-also">{t('also', { names: list(entry.alsoKnownAs) })}</p>}
      {entry.sources.length === 0 ? null : (
        <p className="term-sources">
          {tc('sources', entry.sources.length)}:{' '}
          {entry.sources.map((source, index) => (
            <Fragment key={source.id}>
              {index === 0 ? null : ', '}
              {sourceLink === undefined ? (
                <span lang={source.language}>{source.title}</span>
              ) : (
                <Link to={sourceLink(subjectId, source.id)} lang={source.language}>
                  {source.title}
                </Link>
              )}
            </Fragment>
          ))}
        </p>
      )}
    </div>
  );
}
