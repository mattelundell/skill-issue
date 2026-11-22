import { createElement } from 'react';
import type { TextMark, WebModule } from '../../shell/contract.js';
import { fetchGlossary } from './api.js';
import { TermCard } from './TermCard.js';
import './glossary.css';

/**
 * A subject's glossary in its lessons: each term marked in a text step the
 * first time the step names it, by its own name or any other it goes by, with
 * its definition and sources a point or a press away. A glossary that cannot be
 * read marks nothing, and the lesson reads as written.
 */
export const glossaryModule: WebModule = {
  id: 'glossary',
  textMarks: async (subject, signal): Promise<readonly TextMark[]> => {
    const fetched = await fetchGlossary(subject.id, subject.language, signal);
    if (fetched.kind !== 'ok') {
      return [];
    }
    return fetched.value.terms.map((entry) => ({
      id: entry.id,
      forms: [entry.term, ...entry.alsoKnownAs],
      card: createElement(TermCard, { entry, subjectId: subject.id }),
    }));
  },
};
