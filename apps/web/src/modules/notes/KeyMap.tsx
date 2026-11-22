import { Chord } from './Composer.js';
import { useMessages } from './messages.js';
import { NOTE_KEY, QUOTE_KEY } from './place.js';

/** Every key the notebook answers to, grouped by what it does, each drawn as the chord it is. */
export function KeyMap() {
  const { t } = useMessages();
  const groups = [
    {
      title: t('keys.notebook'),
      rows: [
        [[NOTE_KEY.toUpperCase()], t('keys.toggle')],
        [['Esc'], t('keys.read')],
        [['Enter'], t('keys.write')],
        [[QUOTE_KEY.toUpperCase()], t('keys.quote')],
        [['?'], t('keys.map')],
      ],
    },
    {
      title: t('keys.selection'),
      rows: [
        [['⌘', 'B'], t('fmt.bold')],
        [['⌘', 'I'], t('fmt.italic')],
        [['⌘', '⇧', 'X'], t('fmt.strike')],
        [['⌘', '⇧', 'U'], t('fmt.link')],
        [['⌘', '⇧', 'C'], t('fmt.code')],
      ],
    },
    {
      title: t('keys.lines'),
      rows: [
        [['⌘', '⇧', '7'], t('fmt.ol')],
        [['⌘', '⇧', '8'], t('fmt.ul')],
        [['⌘', '⇧', '9'], t('fmt.quote')],
        [['⌘', 'Z'], t('keys.undo')],
        [['⌘', '⇧', 'Z'], t('keys.redo')],
      ],
    },
  ] as const;
  return (
    <section className="keymap" aria-label={t('keys')}>
      {groups.map((group) => (
        <div key={group.title}>
          <h4>{group.title}</h4>
          <dl>
            {group.rows.map(([keys, what]) => (
              <div key={what} className="keymap-row">
                <dt>
                  <Chord keys={keys} />
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
