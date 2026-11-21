import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

/** Where the app is. The path is the whole state of navigation, so a link can be bookmarked and reloaded. */
export type Route =
  | { readonly kind: 'start' }
  /**
   * A subject's home; `page` is the module whose page is open, or undefined for
   * the overview, and `path` the segments below that page, which the module reads.
   */
  | { readonly kind: 'subject'; readonly subjectId: string; readonly page: string | undefined; readonly path: readonly string[] }
  | { readonly kind: 'not-found' };

const SUBJECT_PATH = /^\/subjects\/([^/]+)(?:\/([^/]+)((?:\/[^/]+)*))?\/?$/;

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') {
    return { kind: 'start' };
  }
  const match = SUBJECT_PATH.exec(pathname);
  const subject = match?.[1];
  if (subject === undefined) {
    return { kind: 'not-found' };
  }
  try {
    const page = match?.[2];
    const below = match?.[3] ?? '';
    return {
      kind: 'subject',
      subjectId: decodeURIComponent(subject),
      page: page === undefined ? undefined : decodeURIComponent(page),
      path: below === '' ? [] : below.slice(1).split('/').map(decodeURIComponent),
    };
  } catch {
    // A malformed escape such as "%E0" names nothing that exists.
    return { kind: 'not-found' };
  }
}

export const startPath = (): string => '/';
export const subjectPath = (subjectId: string, page?: string, path: readonly string[] = []): string =>
  `/subjects/${encodeURIComponent(subjectId)}${page === undefined ? '' : [page, ...path].map((segment) => `/${encodeURIComponent(segment)}`).join('')}`;

/** The event the app listens for besides the browser's own back and forward. */
const NAVIGATED = 'skill-issue:navigated';

export function navigate(path: string): void {
  if (path !== window.location.pathname) {
    window.history.pushState(null, '', path);
  }
  window.dispatchEvent(new Event(NAVIGATED));
  window.scrollTo(0, 0);
}

/** The current route, following links, back and forward. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const follow = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', follow);
    window.addEventListener(NAVIGATED, follow);
    return () => {
      window.removeEventListener('popstate', follow);
      window.removeEventListener(NAVIGATED, follow);
    };
  }, []);
  return route;
}

/** A real link — it opens in a new tab with a modifier key — that navigates in place on a plain click. */
export function Link({ to, children, ...rest }: { readonly to: string; readonly children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={follow} {...rest}>
      {children}
    </a>
  );
}
