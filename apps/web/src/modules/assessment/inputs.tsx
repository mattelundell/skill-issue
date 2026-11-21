import type { AskedQuestion, ExpectedAnswer, GivenAnswer } from '@skill-issue/contract';
import { useId, useState } from 'react';
import { useMessages } from './messages.js';

/**
 * A question type in the browser: how the learner answers it, and how an
 * answer to it is put into words. Each input reports an answer whenever it is
 * complete, and undefined while it is not, so "Answer" waits for a whole one.
 */

type Of<T extends AskedQuestion['type']> = Extract<AskedQuestion, { type: T }>;

interface InputProps<Q extends AskedQuestion> {
  readonly question: Q;
  readonly onChange: (answer: GivenAnswer | undefined) => void;
  readonly disabled: boolean;
}

function Choice({ question, onChange, disabled, many }: InputProps<Of<'single-choice'> | Of<'multiple-choice'>> & { readonly many: boolean }) {
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const name = useId();
  const choose = (id: string): void => {
    const next = many ? (chosen.includes(id) ? chosen.filter((each) => each !== id) : [...chosen, id]) : [id];
    setChosen(next);
    if (many) {
      onChange(next.length === 0 ? undefined : { type: 'multiple-choice', options: next });
    } else {
      onChange({ type: 'single-choice', option: id });
    }
  };
  return (
    <fieldset className="opts" disabled={disabled}>
      <legend className="sr">{question.prompt}</legend>
      {question.options.map((option, index) => (
        <label key={option.id} className={chosen.includes(option.id) ? 'opt chosen' : 'opt'}>
          <input type={many ? 'checkbox' : 'radio'} name={name} value={option.id} checked={chosen.includes(option.id)} onChange={() => choose(option.id)} />
          <kbd aria-hidden="true">{index + 1}</kbd>
          <span>{option.text}</span>
        </label>
      ))}
    </fieldset>
  );
}

function TrueFalse({ question, onChange, disabled }: InputProps<Of<'true-false'>>) {
  const { t } = useMessages();
  const [value, setValue] = useState<boolean>();
  const name = useId();
  return (
    <fieldset className="opts" disabled={disabled}>
      <legend className="sr">{question.prompt}</legend>
      {([true, false] as const).map((option, index) => (
        <label key={String(option)} className={value === option ? 'opt chosen' : 'opt'}>
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => {
              setValue(option);
              onChange({ type: 'true-false', value: option });
            }}
          />
          <kbd aria-hidden="true">{index + 1}</kbd>
          <span>{option ? t('true') : t('false')}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** A number as a Swede or an Englishman types it: a comma or a point for decimals, spaces between thousands. */
export function parseNumber(text: string): number | undefined {
  const cleaned = text.trim().replace(/[\s ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return undefined;
  }
  return Number(cleaned);
}

function Numeric({ question, onChange, disabled }: InputProps<Of<'numeric'>>) {
  const { t } = useMessages();
  const id = useId();
  return (
    <div className="numeric">
      <label className="sr" htmlFor={id}>
        {t('numeric.label', { unit: question.unit })}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => {
          const value = parseNumber(event.target.value);
          onChange(value === undefined ? undefined : { type: 'numeric', value });
        }}
      />
      <span>{question.unit}</span>
    </div>
  );
}

function ShortText({ onChange, disabled }: InputProps<Of<'short-text'>>) {
  const { t } = useMessages();
  const id = useId();
  return (
    <div className="short">
      <label className="sr" htmlFor={id}>
        {t('short.label')}
      </label>
      <input
        id={id}
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.trim() === '' ? undefined : { type: 'short-text', text: event.target.value })}
      />
    </div>
  );
}

function Ordering({ question, onChange, disabled }: InputProps<Of<'ordering'>>) {
  const { t } = useMessages();
  const [items, setItems] = useState<readonly string[]>(question.items);
  const move = (from: number, to: number): void => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved !== undefined) {
      next.splice(to, 0, moved);
      setItems(next);
      onChange({ type: 'ordering', items: next });
    }
  };
  return (
    <ol className="ordering">
      {items.map((item, index) => (
        <li key={item}>
          <span>{item}</span>
          <button type="button" disabled={disabled || index === 0} onClick={() => move(index, index - 1)} aria-label={t('ordering.up', { item })}>
            ↑
          </button>
          <button type="button" disabled={disabled || index === items.length - 1} onClick={() => move(index, index + 1)} aria-label={t('ordering.down', { item })}>
            ↓
          </button>
        </li>
      ))}
    </ol>
  );
}

function Matching({ question, onChange, disabled }: InputProps<Of<'matching'>>) {
  const { t } = useMessages();
  const [pairs, setPairs] = useState<Readonly<Record<string, string>>>({});
  return (
    <dl className="matching">
      {question.lefts.map((left) => (
        <div key={left}>
          <dt id={`${question.id}-${left}`}>{left}</dt>
          <dd>
            <select
              aria-labelledby={`${question.id}-${left}`}
              disabled={disabled}
              value={pairs[left] ?? ''}
              onChange={(event) => {
                const next = { ...pairs, [left]: event.target.value };
                setPairs(next);
                const complete = question.lefts.every((each) => (next[each] ?? '') !== '');
                onChange(complete ? { type: 'matching', pairs: question.lefts.map((each) => ({ left: each, right: next[each] ?? '' })) } : undefined);
              }}
            >
              <option value="">{t('matching.choose')}</option>
              {question.rights.map((right) => (
                <option key={right} value={right}>
                  {right}
                </option>
              ))}
            </select>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FreeRecall({ question, onChange, disabled }: InputProps<Of<'free-recall'>>) {
  const { t } = useMessages();
  const [shown, setShown] = useState(false);
  const [knew, setKnew] = useState<boolean>();
  if (!shown) {
    return (
      <div className="recall">
        <p className="hint">{t('recall.think')}</p>
        <button type="button" className="btn quiet small" disabled={disabled} onClick={() => setShown(true)}>
          {t('recall.show')}
        </button>
      </div>
    );
  }
  return (
    <div className="recall">
      <blockquote>{question.answer}</blockquote>
      <p className="hint">{t('recall.self')}</p>
      <fieldset className="opts row" disabled={disabled}>
        <legend className="sr">{t('recall.self')}</legend>
        {([true, false] as const).map((option) => (
          <label key={String(option)} className={knew === option ? 'opt chosen' : 'opt'}>
            <input
              type="radio"
              checked={knew === option}
              onChange={() => {
                setKnew(option);
                onChange({ type: 'free-recall', knew: option });
              }}
            />
            <span>{option ? t('recall.knew') : t('recall.not')}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/** How the learner answers a question, by its type. */
export function AnswerInput({ question, onChange, disabled }: InputProps<AskedQuestion>) {
  switch (question.type) {
    case 'single-choice':
      return <Choice question={question} onChange={onChange} disabled={disabled} many={false} />;
    case 'multiple-choice':
      return <Choice question={question} onChange={onChange} disabled={disabled} many />;
    case 'true-false':
      return <TrueFalse question={question} onChange={onChange} disabled={disabled} />;
    case 'numeric':
      return <Numeric question={question} onChange={onChange} disabled={disabled} />;
    case 'short-text':
      return <ShortText question={question} onChange={onChange} disabled={disabled} />;
    case 'ordering':
      return <Ordering question={question} onChange={onChange} disabled={disabled} />;
    case 'matching':
      return <Matching question={question} onChange={onChange} disabled={disabled} />;
    case 'free-recall':
      return <FreeRecall question={question} onChange={onChange} disabled={disabled} />;
    default: {
      const unknown: never = question;
      return unknown;
    }
  }
}

/** An option's words, by its id. */
const optionText = (question: AskedQuestion, id: string): string => ('options' in question ? (question.options.find((option) => option.id === id)?.text ?? id) : id);

/** An answer — the learner's or the right one — in words, the way a teacher would read it back. */
export function useWords(): (question: AskedQuestion, answer: GivenAnswer | ExpectedAnswer) => string {
  const { t } = useMessages();
  return (question, answer) => {
    switch (answer.type) {
      case 'single-choice':
        return optionText(question, answer.option);
      case 'multiple-choice':
        return answer.options.map((id) => optionText(question, id)).join(', ');
      case 'true-false':
        return answer.value ? t('true') : t('false');
      case 'numeric':
        return 'unit' in answer ? `${String(answer.value).replace('.', ',')} ${answer.unit}` : `${String(answer.value).replace('.', ',')}${question.type === 'numeric' ? ` ${question.unit}` : ''}`;
      case 'short-text':
        return 'accepted' in answer ? answer.accepted.join(' / ') : answer.text;
      case 'ordering':
        return answer.items.join(' → ');
      case 'matching':
        return answer.pairs.map((pair) => `${pair.left} – ${pair.right}`).join(', ');
      case 'free-recall':
        return 'knew' in answer ? (answer.knew ? t('recall.knew') : t('recall.not')) : answer.answer;
      default: {
        const unknown: never = answer;
        return unknown;
      }
    }
  };
}
