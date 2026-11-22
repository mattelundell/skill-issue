import MarkdownIt from 'markdown-it';
import { API_PREFIX } from '@skill-issue/contract';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { TextMark } from './contract.js';
import { compileMarks, type Matcher } from './marks.js';

/**
 * Subject material is Markdown. It is rendered with raw HTML switched off, so
 * any markup in it is shown as text, and with markdown-it's own link check,
 * which drops script and data links. A pack that carries either is refused
 * when it is loaded; this holds even if one is not.
 */
const markdown = new MarkdownIt({ html: false, linkify: false });

/** What marking words needs while one text is rendered: the forms, which marks are already found, and how deep in a heading or link the renderer is. */
interface MarkEnv {
  readonly matcher: Matcher;
  readonly marked: Set<number>;
  readonly cardId: string;
  /** Above zero inside a heading or a link, where nothing is marked: a heading names its subject, and a link is already something to press. */
  readonly skip: { depth: number };
}

const hasMarks = (env: unknown): env is { marks: MarkEnv } => typeof env === 'object' && env !== null && 'marks' in env && typeof env.marks === 'object' && env.marks !== null;

const skipping = (rule: 'heading_open' | 'heading_close' | 'link_close', by: number): void => {
  const fallback = markdown.renderer.rules[rule];
  markdown.renderer.rules[rule] = (tokens, index, options, env, self) => {
    if (hasMarks(env)) {
      const { skip } = env.marks;
      skip.depth += by;
    }
    return fallback === undefined ? self.renderToken(tokens, index, options) : fallback(tokens, index, options, env, self);
  };
};
skipping('heading_open', 1);
skipping('heading_close', -1);
skipping('link_close', -1);

/** Plain text, with each mark found in it drawn as a button that opens the mark's card. Inline code is a token of its own and never reaches here. */
markdown.renderer.rules['text'] = (tokens, index, _options, env: unknown) => {
  const content = tokens[index]?.content ?? '';
  const escape = markdown.utils.escapeHtml;
  if (!hasMarks(env) || env.marks.skip.depth > 0) {
    return escape(content);
  }
  const { matcher, marked, cardId } = env.marks;
  return matcher
    .find(content, marked)
    .map((segment) =>
      typeof segment === 'string'
        ? escape(segment)
        : `<button type="button" class="term" data-mark="${segment.mark}" aria-expanded="false" aria-controls="${escape(cardId)}">${escape(segment.text)}</button>`,
    )
    .join('');
};

const defaultLinkOpen = markdown.renderer.rules['link_open'];
markdown.renderer.rules['link_open'] = (tokens, index, options, env, self) => {
  if (hasMarks(env)) {
    const { skip } = env.marks;
    skip.depth += 1;
  }
  const token = tokens[index];
  const href = String(token?.attrGet('href') ?? '');
  if (token !== undefined && /^(https?|mailto):/i.test(href)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen === undefined ? self.renderToken(tokens, index, options) : defaultLinkOpen(tokens, index, options, env, self);
};

interface Env {
  readonly subjectId: string;
  readonly imageText: (alt: string) => string;
}

const isEnv = (value: unknown): value is Env =>
  typeof value === 'object' && value !== null && 'imageText' in value && typeof value.imageText === 'function' && 'subjectId' in value && typeof value.subjectId === 'string';

/** A file in the pack's assets folder, the only place an image may come from. */
const ASSET = /^assets\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;

/**
 * An image is drawn from the subject's own files, served by the application,
 * with its description as alt text and its title, if any, as a caption. Anything
 * else — a web address, a path out of assets/ — is shown as its text; a pack
 * carrying one is refused when loaded, and this holds even if one is not.
 */
markdown.renderer.rules['image'] = (tokens, index, _options, env: unknown) => {
  const token = tokens[index];
  const alt = token?.children?.map((child) => child.content).join('') ?? '';
  const text = isEnv(env) ? env.imageText(alt) : alt;
  const file = ASSET.exec(String(token?.attrGet('src') ?? ''))?.[1];
  if (!isEnv(env) || file === undefined) {
    return markdown.utils.escapeHtml(text);
  }
  const escape = markdown.utils.escapeHtml;
  const src = `${API_PREFIX}/content/subjects/${encodeURIComponent(env.subjectId)}/assets/${encodeURIComponent(file)}`;
  const title = String(token?.attrGet('title') ?? '');
  const image = `<img src="${escape(src)}" alt="${escape(alt)}" data-text="${escape(text)}" loading="lazy">`;
  return `<span class="figure">${image}${title === '' ? '' : `<span class="caption">${escape(title)}</span>`}</span>`;
};

/** How long a card stays once the pointer has left its mark and the card, so the pointer can cross the gap between them. */
const CLOSE_AFTER_MS = 300;

export function Markdown({
  source,
  subjectId,
  imageText,
  className,
  marks,
}: {
  readonly source: string;
  /** The subject whose files the material's images come from. */
  readonly subjectId: string;
  /** An image's description as words, shown in its place when it cannot be drawn. */
  readonly imageText: (alt: string) => string;
  readonly className?: string;
  /** Words to mark, each the first time the text names it, with the card it opens; none, and the text is drawn as written. */
  readonly marks?: readonly TextMark[];
}) {
  const cardId = `${useId()}-card`;
  const matcher = useMemo(() => (marks === undefined || marks.length === 0 ? undefined : compileMarks(marks)), [marks]);
  const html = useMemo(
    () =>
      markdown.render(source, {
        subjectId,
        imageText,
        ...(matcher === undefined ? {} : { marks: { matcher, marked: new Set<number>(), cardId, skip: { depth: 0 } } satisfies MarkEnv }),
      }),
    [source, subjectId, imageText, matcher, cardId],
  );
  const drawn = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // An image that cannot be fetched becomes its text, rather than a broken picture.
    const container = drawn.current;
    const swap = (event: Event): void => {
      const image = event.target;
      if (image instanceof HTMLImageElement) {
        image.replaceWith(document.createTextNode(image.dataset['text'] ?? image.alt));
      }
    };
    container?.addEventListener('error', swap, true);
    return () => container?.removeEventListener('error', swap, true);
  }, [html]);
  // markdown-it built this from the source with raw HTML off and unsafe links dropped, so it holds no markup the material wrote itself.
  const text = <div ref={drawn} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  return marks === undefined || matcher === undefined ? text : <MarkedText key={html} text={text} drawn={drawn} marks={marks} cardId={cardId} />;
}

/**
 * The marks' cards around the drawn text. One card shows at a time, under its
 * mark: while the pointer is on the mark or the card, while the mark has the
 * focus, or from a click until the mark is clicked again or the focus leaves.
 * Escape closes it and puts the focus back on its mark.
 *
 * The card is drawn into a slot placed straight after its mark, so it comes
 * next in the reading and Tab order: from the mark, Tab reaches a link in the
 * card before any later mark in the text.
 */
interface Open {
  readonly mark: number;
  readonly pinned: boolean;
  readonly slot: HTMLElement;
}

function MarkedText({
  text,
  drawn,
  marks,
  cardId,
}: {
  readonly text: ReactElement;
  readonly drawn: RefObject<HTMLDivElement | null>;
  readonly marks: readonly TextMark[];
  readonly cardId: string;
}) {
  const [open, setOpen] = useState<Open>();
  const current = useRef<Open>(undefined);
  const frame = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLSpanElement>(null);

  // The drawn text is not React's, so its marks are told by hand which one is open, an old slot is taken away, and the card is placed under its mark.
  useLayoutEffect(() => {
    const before = current.current;
    if (before !== undefined && before.slot !== open?.slot) {
      before.slot.remove();
    }
    current.current = open;
    for (const mark of drawn.current?.querySelectorAll('button.term') ?? []) {
      mark.setAttribute('aria-expanded', String(open !== undefined && mark.getAttribute('data-mark') === String(open.mark)));
    }
    const anchor = open?.slot.previousElementSibling;
    if (anchor === null || anchor === undefined || frame.current === null || card.current === null) {
      return;
    }
    const within = frame.current.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    const width = card.current.offsetWidth;
    const height = card.current.offsetHeight;
    // Under the mark, unless the window ends before the card does and there is more room above it.
    const below = window.innerHeight - at.bottom;
    const above = at.top - height - 6 >= 0 && below < height + 6 && at.top > below;
    card.current.style.top = `${(above ? at.top - height - 6 : at.bottom + 6) - within.top}px`;
    card.current.style.left = `${Math.max(0, Math.min(at.left - within.left, within.width - width))}px`;
  }, [open, drawn]);
  useLayoutEffect(() => () => current.current?.slot.remove(), []);

  // The marks are in markup React did not draw, so their events are caught where they bubble to, with native listeners,
  // attached as the markup is committed: a passive effect would leave the marks on screen, unable to open, until it ran.
  useLayoutEffect(() => {
    const host = frame.current;
    if (host === null) {
      return undefined;
    }
    let closing: ReturnType<typeof setTimeout> | undefined;
    const cancelClose = (): void => clearTimeout(closing);
    const markOf = (target: EventTarget | null): HTMLButtonElement | undefined => {
      const found = target instanceof Element ? target.closest('button.term') : null;
      return found instanceof HTMLButtonElement && drawn.current?.contains(found) === true ? found : undefined;
    };
    const inCard = (target: EventTarget | null): boolean => target instanceof Node && current.current?.slot.contains(target) === true;
    const isOpenMark = (target: EventTarget | null): boolean => {
      const mark = markOf(target);
      return mark !== undefined && current.current?.slot.previousElementSibling === mark;
    };
    /** Opens `mark`'s card, in a slot after the mark: the slot already there when the card is open. */
    const show = (mark: HTMLButtonElement, pinned: boolean): void => {
      const now = current.current;
      if (now !== undefined && now.slot.previousElementSibling === mark) {
        setOpen({ ...now, pinned });
        return;
      }
      const slot = document.createElement('span');
      slot.className = 'term-slot';
      mark.after(slot);
      setOpen({ mark: Number(mark.dataset['mark']), pinned, slot });
    };
    const close = (): void => setOpen(undefined);
    const closeSoon = (): void => {
      cancelClose();
      closing = setTimeout(() => {
        if (current.current?.pinned !== true) {
          close();
        }
      }, CLOSE_AFTER_MS);
    };

    const over = (event: Event): void => {
      const mark = markOf(event.target);
      if (mark !== undefined) {
        cancelClose();
        // A card opened by a click stays until it is closed, whatever else the pointer passes.
        if (current.current?.pinned !== true || isOpenMark(mark)) {
          show(mark, current.current?.pinned === true);
        }
      } else if (inCard(event.target)) {
        cancelClose();
      }
    };
    const out = (event: Event): void => {
      const to = event instanceof MouseEvent ? event.relatedTarget : null;
      const fromMark = markOf(event.target);
      if (fromMark === undefined && !inCard(event.target)) {
        return;
      }
      // Moving within the mark or the card, or between the open mark and its card, is not leaving.
      if (inCard(to) || (to instanceof Node && fromMark?.contains(to) === true) || isOpenMark(to)) {
        return;
      }
      closeSoon();
    };
    const click = (event: Event): void => {
      const mark = markOf(event.target);
      if (mark !== undefined) {
        cancelClose();
        if (isOpenMark(mark) && current.current?.pinned === true) {
          close();
        } else {
          show(mark, true);
        }
      }
    };
    const focusIn = (event: Event): void => {
      const mark = markOf(event.target);
      if (mark !== undefined && !isOpenMark(mark)) {
        show(mark, false);
      }
    };
    const focusOut = (event: Event): void => {
      const to = event instanceof FocusEvent ? event.relatedTarget : null;
      // Moving into the card, to a link in it, or from the card back to its mark keeps it.
      if (inCard(to) || isOpenMark(to)) {
        return;
      }
      if (markOf(event.target) !== undefined || inCard(event.target)) {
        close();
      }
    };
    const key = (event: Event): void => {
      const mark = current.current?.slot.previousElementSibling;
      if (!(event instanceof KeyboardEvent) || event.key !== 'Escape' || !(mark instanceof HTMLButtonElement)) {
        return;
      }
      // The card is what Escape closes here, not whatever else on the page listens for it.
      event.stopPropagation();
      close();
      if (document.activeElement !== mark) {
        mark.focus();
      }
    };

    const listeners = [
      ['pointerover', over],
      ['pointerout', out],
      ['click', click],
      ['focusin', focusIn],
      ['focusout', focusOut],
      ['keydown', key],
    ] as const;
    for (const [type, listener] of listeners) {
      host.addEventListener(type, listener);
    }
    return () => {
      cancelClose();
      for (const [type, listener] of listeners) {
        host.removeEventListener(type, listener);
      }
    };
  }, [drawn]);

  return (
    <div ref={frame} className="marked-text">
      {text}
      {open === undefined
        ? null
        : createPortal(
            <span ref={card} id={cardId} className="term-card">
              {marks[open.mark]?.card}
            </span>,
            open.slot,
          )}
    </div>
  );
}

/** The words of a Markdown text with its markup taken away, a line per block: what a search looks through. */
export function plainText(source: string): string {
  const lines: string[] = [];
  for (const token of markdown.parse(source, {})) {
    if (token.type === 'inline') {
      lines.push((token.children ?? []).map((child) => (child.type === 'text' || child.type === 'code_inline' ? child.content : child.type === 'softbreak' ? ' ' : '')).join(''));
    }
  }
  return lines.join('\n');
}
