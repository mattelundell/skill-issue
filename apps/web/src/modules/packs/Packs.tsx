import type { ContentFault, LoadResult } from '@skill-issue/contract';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { AppPageProps } from '../../shell/contract.js';
import { useI18n } from '../../shell/i18n.js';
import { Link, subjectPath } from '../../shell/router.js';
import { sendPack } from './api.js';
import { useMessages } from './messages.js';

type State =
  | { readonly kind: 'waiting'; readonly notZip?: string }
  | { readonly kind: 'checking'; readonly name: string }
  | { readonly kind: 'faults'; readonly faults: readonly ContentFault[] }
  | { readonly kind: 'refused'; readonly title: string; readonly detail: string | undefined }
  | { readonly kind: 'ready'; readonly zip: Blob; readonly result: LoadResult }
  | { readonly kind: 'loading' }
  | { readonly kind: 'done'; readonly subject: string }
  | { readonly kind: 'failed' };

const isZip = (file: File): boolean => file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';

/** The way a subject pack comes in from the browser: dropped or chosen as a zip, checked, and loaded on the learner's word. */
export function PacksPage(_props: AppPageProps) {
  const { t, tc } = useMessages();
  const app = useI18n().t('app.title');
  const title = t('page.title');
  const [state, setState] = useState<State>({ kind: 'waiting' });
  const [over, setOver] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A page outside the subjects is given no title by the shell, so the last page's would stay.
    document.title = `${title} · ${app}`;
  }, [title, app]);

  const take = async (file: File | undefined): Promise<void> => {
    if (file === undefined) {
      return;
    }
    if (!isZip(file)) {
      setState({ kind: 'waiting', notZip: file.name });
      return;
    }
    setState({ kind: 'checking', name: file.name });
    const checked = await sendPack(file, true);
    switch (checked.kind) {
      case 'checked':
        setState({ kind: 'ready', zip: file, result: checked.result });
        return;
      case 'faults':
        setState({ kind: 'faults', faults: checked.faults });
        return;
      case 'refused':
        setState({ kind: 'refused', title: checked.title, detail: checked.detail });
        return;
      case 'failed':
        setState({ kind: 'failed' });
        return;
      default: {
        const unhandled: never = checked;
        return unhandled;
      }
    }
  };

  const load = async (zip: Blob): Promise<void> => {
    setState({ kind: 'loading' });
    const loaded = await sendPack(zip, false);
    setState(
      loaded.kind === 'checked'
        ? { kind: 'done', subject: loaded.result.subject }
        : loaded.kind === 'faults'
          ? { kind: 'faults', faults: loaded.faults }
          : loaded.kind === 'refused'
            ? { kind: 'refused', title: loaded.title, detail: loaded.detail }
            : { kind: 'failed' },
    );
  };

  const again = (): void => setState({ kind: 'waiting' });
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setOver(false);
    void take(event.dataTransfer.files[0]);
  };

  return (
    <div className="packs">
      <h1 className="page-title">{title}</h1>
      <p className="lede">{t('page.intro')}</p>
      <div className="sheet packs-sheet">
        {state.kind === 'waiting' || state.kind === 'failed' ? (
          <>
            <div
              className={over ? 'dropzone over' : 'dropzone'}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <p className="dropzone-label">{t('drop.label')}</p>
              <p>
                {t('drop.or')}{' '}
                <button type="button" className="btn" onClick={() => chooser.current?.click()}>
                  {t('drop.choose')}
                </button>
              </p>
              <input
                ref={chooser}
                type="file"
                accept=".zip,application/zip"
                className="sr"
                aria-label={t('drop.choose')}
                onChange={(event) => {
                  void take(event.currentTarget.files?.[0]);
                  // Emptied, so choosing the same file again is a change too.
                  if (chooser.current !== null) {
                    chooser.current.value = '';
                  }
                }}
              />
            </div>
            {state.kind === 'waiting' && state.notZip !== undefined ? (
              <p role="alert" className="packs-problem">
                {t('drop.not-zip', { name: state.notZip })}
              </p>
            ) : null}
            {state.kind === 'failed' ? (
              <p role="alert" className="packs-problem">
                {t('failed')}
              </p>
            ) : null}
          </>
        ) : null}
        {state.kind === 'checking' ? <p aria-busy="true">{t('checking', { name: state.name })}</p> : null}
        {state.kind === 'loading' ? <p aria-busy="true">{t('loading')}</p> : null}
        {state.kind === 'faults' ? (
          <section role="alert" aria-labelledby="faults-h">
            <h2 id="faults-h">{tc('faults.title', state.faults.length)}</h2>
            <p>{t('faults.body')}</p>
            <ul className="faults">
              {state.faults.map((fault, at) => (
                <li key={at}>
                  <code>{fault.file}</code>
                  {fault.item === null ? null : <span> · {fault.item}</span>}
                  {fault.field === '' ? null : <span> · {fault.field}</span>}
                  <div>{t('fault.expected', { expected: fault.expected, found: fault.found })}</div>
                </li>
              ))}
            </ul>
            <button type="button" className="btn" onClick={again}>
              {t('refused.retry')}
            </button>
          </section>
        ) : null}
        {state.kind === 'refused' ? (
          <section role="alert">
            <h2>{state.title}</h2>
            {state.detail === undefined ? null : <p>{state.detail}</p>}
            <button type="button" className="btn" onClick={again}>
              {t('refused.retry')}
            </button>
          </section>
        ) : null}
        {state.kind === 'ready' ? <Ready result={state.result} onLoad={() => void load(state.zip)} onCancel={again} /> : null}
        {state.kind === 'done' ? (
          <section>
            <h2>{t('done.title', { subject: state.subject })}</h2>
            <div className="actions">
              <Link to={subjectPath(state.subject)} className="btn">
                {t('done.open')}
              </Link>
              <button type="button" className="btn quiet" onClick={again}>
                {t('done.another')}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Ready({ result, onLoad, onCancel }: { readonly result: LoadResult; readonly onLoad: () => void; readonly onCancel: () => void }) {
  const { t, tc } = useMessages();
  const same = !result.created && result.added.length === 0 && result.changed.length === 0 && result.retired.length === 0;
  if (same) {
    return (
      <section>
        <h2>{t('ready.same', { subject: result.subject })}</h2>
        <button type="button" className="btn" onClick={onCancel}>
          {t('refused.retry')}
        </button>
      </section>
    );
  }
  const counts = [
    result.added.length > 0 ? tc('ready.added', result.added.length) : undefined,
    result.changed.length > 0 ? tc('ready.changed', result.changed.length) : undefined,
    result.retired.length > 0 ? tc('ready.retired', result.retired.length) : undefined,
    result.created || result.unchanged === 0 ? undefined : t('ready.unchanged', { count: String(result.unchanged) }),
  ].filter((count) => count !== undefined);
  return (
    <section>
      <h2>{t(result.created ? 'ready.new' : 'ready.update', { subject: result.subject })}</h2>
      <p>{counts.join(', ')}.</p>
      {result.created ? null : <p className="lede">{t('ready.history')}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={onLoad}>
          {t('ready.load')}
        </button>
        <button type="button" className="btn quiet" onClick={onCancel}>
          {t('ready.cancel')}
        </button>
      </div>
    </section>
  );
}

/** The way to the page, in the footer beside the others. */
export function PacksFooter(_props: { readonly language: string }) {
  const { t } = useMessages();
  return (
    <Link className="packs-link" to="/packs">
      {t('footer.link')}
    </Link>
  );
}
