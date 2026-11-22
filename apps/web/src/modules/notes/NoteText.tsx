import { headingsBelow } from '@skill-issue/contract';
import { useCallback, useMemo } from 'react';
import { Markdown } from '../../shell/markdown.js';
import { noteImageSource } from './api.js';
import { useMessages } from './messages.js';

/**
 * A note as read: its Markdown drawn with the learner's own headings moved
 * `below` levels down, so none reads larger than the notebook's area and
 * lesson headings around it, and its images taken from the notebook.
 */
export function NoteText({ subjectId, body, below, className = 'md' }: { readonly subjectId: string; readonly body: string; readonly below: number; readonly className?: string }) {
  const { t } = useMessages();
  const imageText = useCallback((alt: string) => t('image', { alt }), [t]);
  const imageSource = useMemo(() => noteImageSource(subjectId), [subjectId]);
  const source = useMemo(() => headingsBelow(body, below), [body, below]);
  return <Markdown className={className} source={source} subjectId={subjectId} imageText={imageText} imageSource={imageSource} />;
}
