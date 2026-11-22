import type { Recording } from '@skill-issue/contract';
import { useEffect, useState } from 'react';
import type { Language } from '../../i18n/index.js';
import type { AppPageProps } from '../../shell/contract.js';
import { useI18n } from '../../shell/i18n.js';
import { usePolled } from '../../shell/poll.js';
import { appPagePath, Link } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchRecordings, recordingFileUrl, removeRecording, sendEvents, sendEventsAtExit } from './api.js';
import { useMessages } from './messages.js';
import { startRecorder } from './recorder.js';
import { ended, refreshRecording, start, stop, useRecording, whileRecording } from './state.js';

const PAGE = appPagePath('diagnostics');

/**
 * The footer's way to the diagnostics page, which says plainly when a session
 * is being recorded. While one is, it follows the session: it is on every
 * screen for as long as the app is open.
 */
export function RecordingFooter(_props: { readonly language: Language }) {
  const { t } = useMessages();
  const recording = useRecording();
  const id = recording?.id;
  // Asked again now and then, so a recording ended or started elsewhere — another tab, the command line — is followed here.
  usePolled(refreshRecording);

  useEffect(() => {
    if (id === undefined) {
      return undefined;
    }
    const finish = startRecorder({
      send: async (events) => sendEvents(id, events),
      sendAtExit: (events) => sendEventsAtExit(id, events),
      onEnded: ended,
    });
    whileRecording(finish);
    return () => {
      whileRecording(undefined);
      void finish();
    };
  }, [id]);

  if (recording === undefined || recording === null) {
    return (
      <Link className="diagnostics-link" to={PAGE}>
        {t('footer.link')}
      </Link>
    );
  }
  return (
    <Link className="diagnostics-link recording" to={PAGE}>
      <span className="dot" aria-hidden="true" />
      {t('footer.recording')}
    </Link>
  );
}

const when = (language: Language, moment: string): string => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(moment));
const clock = (language: Language, moment: string): string => new Intl.DateTimeFormat(language, { timeStyle: 'short' }).format(new Date(moment));

/** Starting and stopping a recording, and every recording kept, each to export or remove. */
export function DiagnosticsPage({ language }: AppPageProps) {
  const { t } = useMessages();
  const recording = useRecording();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { fetched, retry } = useFetched('diagnostics/recordings', fetchRecordings);
  const app = useI18n().t('app.title');
  const title = t('page.title');

  useEffect(() => {
    // A page outside the subjects is given no title by the shell, so the last page's would stay.
    document.title = `${title} · ${app}`;
  }, [title, app]);

  const act = async (action: () => Promise<boolean>): Promise<void> => {
    setBusy(true);
    const done = await action();
    setBusy(false);
    setFailed(!done);
    retry();
  };

  return (
    <div className="diagnostics">
      <section className="sheet">
        <h1>{t('page.title')}</h1>
        <p>{t('page.intro')}</p>
        <p>{t('page.what')}</p>
        <p>{t('page.where')}</p>
        <div className="diagnostics-control">
          {recording === undefined ? null : recording === null ? (
            <>
              <p>{t('page.not-recording')}</p>
              <button type="button" className="btn" disabled={busy} onClick={() => void act(async () => start(language))}>
                {t('page.start')}
              </button>
            </>
          ) : (
            <>
              <p className="recording">
                <span className="dot" aria-hidden="true" />
                {t('page.recording', { time: clock(language, recording.startedAt) })}
              </p>
              <button type="button" className="btn" disabled={busy} onClick={() => void act(async () => stop(recording.id))}>
                {t('page.stop')}
              </button>
            </>
          )}
          {failed ? (
            <p role="alert" className="diagnostics-failed">
              {t('page.failed')}
            </p>
          ) : null}
        </div>
      </section>
      <section className="sheet">
        <h2>{t('page.list')}</h2>
        {fetched === undefined ? (
          <p aria-busy="true">{t('page.loading')}</p>
        ) : fetched.kind !== 'ok' ? (
          <div role="alert">
            <p>{t('page.list-failed')}</p>
            <button type="button" className="btn quiet small" onClick={retry}>
              {t('page.retry')}
            </button>
          </div>
        ) : fetched.value.recordings.length === 0 ? (
          <p>{t('page.none')}</p>
        ) : (
          <ul className="recordings">
            {fetched.value.recordings.map((kept) => (
              <RecordingRow key={kept.id} recording={kept} language={language} onRemoved={retry} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RecordingRow({ recording, language, onRemoved }: { readonly recording: Recording; readonly language: Language; readonly onRemoved: () => void }) {
  const { t, tc } = useMessages();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const span = recording.endedAt === null ? `${when(language, recording.startedAt)} –` : `${when(language, recording.startedAt)} – ${clock(language, recording.endedAt)}`;
  const state = recording.endedAt === null ? t('row.under-way') : recording.endedBy === 'full' ? t('row.full') : undefined;

  const remove = async (): Promise<void> => {
    setBusy(true);
    await removeRecording(recording.id);
    setBusy(false);
    setConfirming(false);
    onRemoved();
  };

  return (
    <li className="recording-row">
      <div>
        <span className="recording-span">{span}</span>
        <span className="recording-facts">
          {tc('row.events', recording.events)}
          {state === undefined ? null : ` · ${state}`}
        </span>
      </div>
      {confirming ? (
        <div className="recording-actions">
          <span>{t('row.remove.question')}</span>
          <button type="button" className="btn small" disabled={busy} onClick={() => void remove()}>
            {t('row.remove.confirm')}
          </button>
          <button type="button" className="btn quiet small" disabled={busy} onClick={() => setConfirming(false)}>
            {t('row.remove.cancel')}
          </button>
        </div>
      ) : (
        <div className="recording-actions">
          <a className="btn small" href={recordingFileUrl(recording.id)} download>
            {t('row.export')}
          </a>
          <button type="button" className="btn quiet small" onClick={() => setConfirming(true)}>
            {t('row.remove')}
          </button>
        </div>
      )}
    </li>
  );
}
