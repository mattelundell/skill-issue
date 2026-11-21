import MarkdownIt from 'markdown-it';
import { API_PREFIX } from '@skill-issue/contract';
import { useEffect, useMemo, useRef } from 'react';

/**
 * Subject material is Markdown. It is rendered with raw HTML switched off, so
 * any markup in it is shown as text, and with markdown-it's own link check,
 * which drops script and data links. A pack that carries either is refused
 * when it is loaded; this holds even if one is not.
 */
const markdown = new MarkdownIt({ html: false, linkify: false });

const defaultLinkOpen = markdown.renderer.rules['link_open'];
markdown.renderer.rules['link_open'] = (tokens, index, options, env, self) => {
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

export function Markdown({
  source,
  subjectId,
  imageText,
  className,
}: {
  readonly source: string;
  /** The subject whose files the material's images come from. */
  readonly subjectId: string;
  /** An image's description as words, shown in its place when it cannot be drawn. */
  readonly imageText: (alt: string) => string;
  readonly className?: string;
}) {
  const html = useMemo(() => markdown.render(source, { subjectId, imageText } satisfies Env), [source, subjectId, imageText]);
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
  return <div ref={drawn} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
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
