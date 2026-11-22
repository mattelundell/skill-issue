#!/usr/bin/env node
import { createInterface } from 'node:readline';
import type { Terminal } from './asking.js';
import { backup, exportNotes, restore } from './backup.js';
import { parseCommand, USAGE } from './command.js';
import { exam } from './exam.js';
import { exportSubject, load, validate, type Outcome } from './pack.js';
import { review } from './review.js';
import { fetchStatus, report } from './status.js';

const finish = ({ text, exitCode }: Outcome): void => {
  (exitCode === 0 ? process.stdout : process.stderr).write(`${text}\n`);
  process.exitCode = exitCode;
};

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The terminal as a session reads it. Lines are taken from one iterator over
 * the input, which buffers them, so answers piped in ahead of their questions
 * are read in turn rather than lost; the end of the input reads as undefined.
 */
function openTerminal(): Terminal & { readonly close: () => void } {
  const lines = createInterface({ input: process.stdin, terminal: false, crlfDelay: Number.POSITIVE_INFINITY });
  const iterator = lines[Symbol.asyncIterator]();
  return {
    write: (text) => {
      process.stdout.write(text);
    },
    read: async (prompt) => {
      process.stdout.write(prompt);
      const next = await iterator.next();
      if (next.done === true) {
        process.stdout.write('\n');
        return undefined;
      }
      return next.value;
    },
    close: () => lines.close(),
  };
}

const command = parseCommand(process.argv.slice(2));

switch (command.kind) {
  case 'help':
    process.stdout.write(USAGE);
    break;
  case 'invalid':
    process.stderr.write(`${command.message}\n\n${USAGE}`);
    process.exitCode = 2;
    break;
  case 'status':
    finish(report(await fetchStatus(command.url, timeZone)));
    break;
  case 'review': {
    const terminal = openTerminal();
    try {
      finish(await review(command, { terminal, fetch, now: () => performance.now(), timeZone }));
    } finally {
      terminal.close();
    }
    break;
  }
  case 'exam': {
    const terminal = openTerminal();
    try {
      finish(await exam(command, { terminal, fetch, now: () => performance.now(), timeZone }));
    } finally {
      terminal.close();
    }
    break;
  }
  case 'validate':
    finish(await validate(command.path));
    break;
  case 'load':
    finish(await load(command));
    break;
  case 'export':
    finish(await exportSubject(command));
    break;
  case 'export-notes':
    finish(await exportNotes(command));
    break;
  case 'backup':
    finish(await backup(command));
    break;
  case 'restore':
    finish(await restore(command));
    break;
  default: {
    const unhandled: never = command;
    throw new Error(`Unhandled command: ${JSON.stringify(unhandled)}`);
  }
}
