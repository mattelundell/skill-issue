import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { addImage } from './api.js';
import { formatted, lineKind, type Format } from './format.js';
import { useMessages } from './messages.js';
import type { Status } from './save.js';

/**
 * Replaces part of a text area's text through the browser's own editing, so
 * ⌘Z and ⌘⇧Z undo and redo it as they do typing. A browser without that
 * command, such as the one the unit tests run in, gets the text set directly
 * and announced as input, which keeps the field and React in step but outside
 * the undo history.
 */
export function replaceUndoable(field: HTMLTextAreaElement, text: string, from: number, to: number): void {
  field.focus();
  field.setSelectionRange(from, to);
  // oxlint-disable-next-line typescript/no-deprecated -- no other way into a text area's own undo history exists; a browser without it falls back below
  const done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  if (!done) {
    field.setRangeText(text, from, to, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

const svg = (paths: ReactNode): ReactNode => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {paths}
  </svg>
);

/** One stroke and one box for every button, letters included, so none leans or sits off the line. */
const ICONS: Readonly<Record<Exclude<Format, 'h1' | 'h2' | 'p'> | 'image', ReactNode>> = {
  bold: svg(
    <>
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z" />
      <path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    </>,
  ),
  italic: svg(<path d="M10 5h8M6 19h8M14 5l-4 14" />),
  strike: svg(
    <>
      <path d="M16.5 7.5C16 6 14.3 5 12 5 9.5 5 7.5 6.3 7.5 8.4c0 1.5 1 2.6 3 3.1" />
      <path d="M4 12h16" />
      <path d="M8 16.5c.6 1.6 2.3 2.5 4.3 2.5 2.6 0 4.5-1.3 4.5-3.3 0-.8-.3-1.5-.9-2" />
    </>,
  ),
  link: svg(
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>,
  ),
  ol: svg(
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4 5h1.5v4M4 9h3M4 15.5c0-.8.7-1.5 1.5-1.5s1.5.6 1.5 1.3c0 1.2-3 1.7-3 3.2h3" />
    </>,
  ),
  ul: svg(
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <circle cx="5" cy="6" r="1" />
      <circle cx="5" cy="12" r="1" />
      <circle cx="5" cy="18" r="1" />
    </>,
  ),
  quote: svg(<path d="M5 5v14M10 7h9M10 12h9M10 17h6" />),
  code: svg(<path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />),
  block: svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 10l-2 2 2 2M15 10l2 2-2 2" />
    </>,
  ),
  image: svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-9 9" />
    </>,
  ),
};

type Button = { readonly kind: Exclude<Format, 'h1' | 'h2' | 'p'> | 'image'; readonly keys: readonly string[] };
const GROUPS: readonly (readonly Button[] | 'head')[] = [
  [
    { kind: 'bold', keys: ['⌘', 'B'] },
    { kind: 'italic', keys: ['⌘', 'I'] },
    { kind: 'strike', keys: ['⌘', '⇧', 'X'] },
  ],
  'head',
  [
    { kind: 'link', keys: ['⌘', '⇧', 'U'] },
    { kind: 'ol', keys: ['⌘', '⇧', '7'] },
    { kind: 'ul', keys: ['⌘', '⇧', '8'] },
  ],
  [
    { kind: 'quote', keys: ['⌘', '⇧', '9'] },
    { kind: 'code', keys: ['⌘', '⇧', 'C'] },
    { kind: 'block', keys: ['⌘', '⇧', '⌥', 'C'] },
  ],
  [{ kind: 'image', keys: ['⌘', 'V'] }],
];

/** The formats asked for by ⌘⇧ and a key, by the key's place on the keyboard, so a layout that moves the digits still works. */
const SHIFTED: Readonly<Partial<Record<string, Format>>> = { KeyX: 'strike', KeyU: 'link', Digit7: 'ol', Digit8: 'ul', Digit9: 'quote' };

/** The format a key pressed with ⌘ or Ctrl asks for in the note; none for one the browser keeps. Never ⌘E, which a browser extension may take. */
export function formatForKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'altKey'>): Format | undefined {
  const key = event.key.toLowerCase();
  if (!event.shiftKey) {
    return key === 'b' ? 'bold' : key === 'i' ? 'italic' : undefined;
  }
  if (event.code === 'KeyC') {
    return event.altKey ? 'block' : 'code';
  }
  return SHIFTED[event.code];
}

/** A chord drawn as keys. */
export const Chord = ({ keys }: { readonly keys: readonly string[] }) => (
  <span className="chord">
    {keys.map((key, index) => (
      <kbd key={index}>{key}</kbd>
    ))}
  </span>
);

const HEADS = ['p', 'h1', 'h2'] as const;

/**
 * A note being written: a formatting bar over a text area. What the bar does
 * is Markdown around the selection; an image pasted or chosen is sent to the
 * notebook and linked where the caret is.
 */
export function Composer({
  subjectId,
  value,
  onChange,
  label,
  status,
  rows = 12,
  caretAtEnd = false,
  onEscape,
}: {
  readonly subjectId: string;
  readonly value: string;
  readonly onChange: (body: string) => void;
  /** What the field is, for a screen reader: where the note is filed. */
  readonly label: string;
  readonly status: Status;
  readonly rows?: number;
  /** Opened to add to the note: the caret goes on a fresh line at the end. */
  readonly caretAtEnd?: boolean;
  /** Escape in the field; given, the key is taken from whatever else listens for it. */
  readonly onEscape?: () => void;
}) {
  const { t } = useMessages();
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const [head, setHead] = useState<'h1' | 'h2' | 'p'>('p');
  const [menu, setMenu] = useState<'closed' | 'mouse' | 'keyboard'>('closed');
  const [imageLine, setImageLine] = useState<string>();

  // Opened to add to the note, the caret goes at the end, and what is typed there first starts a line of its own. Nothing is
  // written just by opening: the new line arrives with the first character typed, so a section looked at is not saved.
  const freshLine = useRef(false);
  useLayoutEffect(() => {
    const target = field.current;
    if (target === null || !caretAtEnd) {
      return;
    }
    target.focus();
    target.setSelectionRange(target.value.length, target.value.length);
    target.scrollTop = target.scrollHeight;
    freshLine.current = target.value.trim() !== '' && !target.value.endsWith('\n');
  }, [caretAtEnd]);
  const caretTo = useRef<number>(undefined);
  useLayoutEffect(() => {
    if (caretTo.current !== undefined) {
      field.current?.setSelectionRange(caretTo.current, caretTo.current);
      caretTo.current = undefined;
    }
  });

  const apply = (kind: Format): void => {
    const target = field.current;
    if (target === null) {
      return;
    }
    const change = formatted(target.value, target.selectionStart, target.selectionEnd, kind);
    replaceUndoable(target, change.text, change.from, change.to);
    target.setSelectionRange(change.selectStart, change.selectEnd);
    setHead(lineKind(target.value, target.selectionStart));
  };

  const insertImage = useCallback(
    async (file: File) => {
      const target = field.current;
      if (target === null) {
        return;
      }
      setImageLine(t('image.adding'));
      const added = await addImage(subjectId, file);
      if (added.kind === 'refused') {
        setImageLine(t(added.reason === 'type' ? 'image.type' : added.reason === 'size' ? 'image.size' : 'image.failed'));
        return;
      }
      setImageLine(undefined);
      replaceUndoable(target, `\n![${t('image.alt')}](bilder/${added.name})\n`, target.selectionStart, target.selectionEnd);
    },
    [subjectId, t],
  );

  // The heading menu closes on a click anywhere outside it.
  const menuHolder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu === 'closed') {
      return undefined;
    }
    const outside = (event: MouseEvent): void => {
      if (!(event.target instanceof Node && menuHolder.current?.contains(event.target) === true)) {
        setMenu('closed');
      }
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [menu]);
  // Opened from the keyboard, the menu takes the focus on the current choice; opened with the mouse, the note keeps it and no ring is drawn.
  useEffect(() => {
    if (menu === 'keyboard') {
      menuHolder.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    }
  }, [menu]);
  const choose = (kind: 'h1' | 'h2' | 'p'): void => {
    setMenu('closed');
    apply(kind);
  };
  const menuKey = (event: ReactKeyboardEvent): void => {
    const items = [...(menuHolder.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const at = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setMenu('closed');
      field.current?.focus();
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape' && onEscape !== undefined) {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const kind = formatForKey(event);
      if (kind !== undefined) {
        event.preventDefault();
        apply(kind);
      }
    }
  };

  const statusLine = imageLine ?? (status === 'waiting' || status === 'saving' ? t('saving') : status === 'failed' ? t('save-failed') : t('saved'));
  return (
    <>
      <div className="composer">
        {/* A press on the bar never takes the focus from the note, so the selection it acts on stays. */}
        <div className="note-bar" role="toolbar" tabIndex={-1} aria-label={t('bar')} onMouseDown={(event) => event.target instanceof Element && event.target.closest('button') !== null && event.preventDefault()}>
          {GROUPS.map((group, index) =>
            group === 'head' ? (
              <div key="head" className="headpick" ref={menuHolder}>
                <button
                  type="button"
                  className="headbtn"
                  aria-haspopup="menu"
                  aria-expanded={menu !== 'closed'}
                  aria-controls={menuId}
                  aria-label={t('fmt.head')}
                  onClick={(event) => {
                    if (field.current !== null) {
                      setHead(lineKind(field.current.value, field.current.selectionStart));
                    }
                    setMenu((before) => (before !== 'closed' ? 'closed' : event.detail === 0 ? 'keyboard' : 'mouse'));
                  }}
                >
                  <span>{t(`fmt.${head}`)}</span>
                  {svg(<path d="M7 10l5 5 5-5" />)}
                  <span className="tip" aria-hidden="true">
                    {t('fmt.head')}
                  </span>
                </button>
                {menu === 'closed' ? null : (
                  <div className="menu" role="menu" tabIndex={-1} id={menuId} onKeyDown={menuKey}>
                    {HEADS.map((kind) => (
                      <button key={kind} type="button" role="menuitemradio" aria-checked={kind === head} data-head={kind} onClick={() => choose(kind)}>
                        <span>{t(`fmt.${kind}`)}</span>
                        <code aria-hidden="true">{kind === 'h1' ? '#' : kind === 'h2' ? '##' : ''}</code>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span key={index} className="tb-group">
                {index > 0 ? <span className="sep" aria-hidden="true" /> : null}
                {group.map(({ kind, keys }) => (
                  <button
                    key={kind}
                    type="button"
                    data-fmt={kind}
                    aria-label={t(`fmt.${kind}`)}
                    aria-keyshortcuts={keys.join('+').replace('⌘', 'Meta').replace('⇧', 'Shift').replace('⌥', 'Alt')}
                    onClick={() => (kind === 'image' ? picker.current?.click() : apply(kind))}
                  >
                    {ICONS[kind]}
                    <span className="tip" aria-hidden="true">
                      <span>{t(`fmt.${kind}`)}</span>
                      {kind === 'image' ? <small>{t('fmt.image.or')}</small> : null}
                      <Chord keys={keys} />
                    </span>
                  </button>
                ))}
              </span>
            ),
          )}
        </div>
        <textarea
          ref={field}
          className="editor"
          rows={rows}
          aria-label={label}
          placeholder={t('placeholder')}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            const fresh = freshLine.current;
            freshLine.current = false;
            if (fresh && next.length > value.length && next.startsWith(value)) {
              const body = `${value}\n${next.slice(value.length)}`;
              caretTo.current = body.length;
              onChange(body);
              return;
            }
            onChange(next);
            setHead(lineKind(next, event.target.selectionStart));
          }}
          onSelect={(event) => {
            const target = event.currentTarget;
            // The caret moved away from the end before anything was typed: the learner is writing elsewhere.
            if (target.selectionStart !== target.value.length) {
              freshLine.current = false;
            }
            setHead(lineKind(target.value, target.selectionStart));
          }}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const file = [...event.clipboardData.items].find((item) => item.type.startsWith('image/'))?.getAsFile();
            if (file !== null && file !== undefined) {
              event.preventDefault();
              void insertImage(file);
            }
          }}
        />
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            // Emptied, so choosing the same file again is a change too.
            input.value = '';
            if (file !== undefined) {
              void insertImage(file);
            }
          }}
        />
      </div>
      <p className="status">
        <output className={status === 'failed' || (imageLine !== undefined && imageLine !== t('image.adding')) ? 'failed' : undefined} aria-live="polite">
          {statusLine}
        </output>
        <span>{t('as-markdown')}</span>
      </p>
    </>
  );
}
