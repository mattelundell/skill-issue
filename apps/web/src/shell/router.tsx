import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

/** Where the app is. The path is the whole state of navigation, so a link can be bookmarked and reloaded. */
export type Route =
  | { readonly kind: 'start' }
  /**
   * A subject's home; `page` is the module whose page is open, or undefined for
   * the overview, and `path` the segments below that page, which the module reads.
   */
  | { readonly kind: 'subject'; readonly subjectId: string; readonly page: string | undefined; readonly path: readonly string[] }
  /** A module's page outside any subject, at `/<module>`; `path` the segments below it. */
  | { readonly kind: 'app-page'; readonly page: string; readonly path: readonly string[] }
  | { readonly kind: 'not-found' };

const SUBJECT_PATH = /^\/subjects\/([^/]+)(?:\/([^/]+)((?:\/[^/]+)*))?\/?$/;
const APP_PAGE_PATH = /^\/([^/]+)((?:\/[^/]+)*)\/?$/;

const segments = (below: string): readonly string[] => (below === '' ? [] : below.slice(1).split('/').map(decodeURIComponent));

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') {
    return { kind: 'start' };
  }
  const match = SUBJECT_PATH.exec(pathname);
  const subject = match?.[1];
  if (subject === undefined) {
    return appPageRoute(pathname);
  }
  try {
    const page = match?.[2];
    const below = match?.[3] ?? '';
    return {
      kind: 'subject',
      subjectId: decodeURIComponent(subject),
      page: page === undefined ? undefined : decodeURIComponent(page),
      path: segments(below),
    };
  } catch {
    // A malformed escape such as "%E0" names nothing that exists.
    return { kind: 'not-found' };
  }
}

/** Any other address names a module's page outside the subjects; whether that module has one, the screen decides. */
function appPageRoute(pathname: string): Route {
  const match = APP_PAGE_PATH.exec(pathname);
  const page = match?.[1];
  if (page === undefined || page === 'subjects') {
    return { kind: 'not-found' };
  }
  try {
    return { kind: 'app-page', page: decodeURIComponent(page), path: segments(match?.[2] ?? '') };
  } catch {
    return { kind: 'not-found' };
  }
}

export const startPath = (): string => '/';
export const appPagePath = (page: string, path: readonly string[] = []): string => [page, ...path].map((segment) => `/${encodeURIComponent(segment)}`).join('');
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

/**
 * Calls `listener` whenever the app's address changes, by a link or by back and
 * forward, until the returned function is called.
 */
export function onNavigation(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATED, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATED, listener);
  };
}

/** The current route, following links, back and forward. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const follow = (): void => setRoute(parseRoute(window.location.pathname));
    return onNavigation(follow);
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
