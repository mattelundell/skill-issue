import MarkdownIt from 'markdown-it';
import { useMemo } from 'react';

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
  readonly imageText: (alt: string) => string;
}

const isEnv = (value: unknown): value is Env => typeof value === 'object' && value !== null && 'imageText' in value && typeof value.imageText === 'function';

// The application does not serve a pack's images yet, so an image is shown as its text rather than as a broken picture.
markdown.renderer.rules['image'] = (tokens, index, _options, env: unknown) => {
  const alt = tokens[index]?.children?.map((child) => child.content).join('') ?? '';
  return markdown.utils.escapeHtml(isEnv(env) ? env.imageText(alt) : alt);
};

export function Markdown({ source, imageText, className }: { readonly source: string; readonly imageText: (alt: string) => string; readonly className?: string }) {
  const html = useMemo(() => markdown.render(source, { imageText } satisfies Env), [source, imageText]);
  // markdown-it built this from the source with raw HTML off and unsafe links dropped, so it holds no markup the material wrote itself.
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
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
