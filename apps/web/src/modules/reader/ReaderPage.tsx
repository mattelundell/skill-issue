import type { PageProps } from '../../shell/contract.js';
import { Library } from './Library.js';
import { Missing, Source } from './Source.js';

/** The Material tab: the library at the page's own address, one source one step below it. */
export function ReaderPage({ subject, language, path, pathTo }: PageProps) {
  const [sourceId, ...beyond] = path;
  if (sourceId === undefined) {
    return <Library subject={subject} language={language} path={path} pathTo={pathTo} />;
  }
  if (beyond.length > 0) {
    return <Missing sourceId={path.join('/')} pathTo={pathTo} />;
  }
  return <Source key={sourceId} subject={subject} sourceId={sourceId} pathTo={pathTo} />;
}
