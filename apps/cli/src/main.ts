#!/usr/bin/env node
import { parseCommand, USAGE } from './command.js';
import { exportSubject, load, validate, type Outcome } from './pack.js';
import { fetchStatus, report } from './status.js';

const finish = ({ text, exitCode }: Outcome): void => {
  (exitCode === 0 ? process.stdout : process.stderr).write(`${text}\n`);
  process.exitCode = exitCode;
};

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
    finish(report(await fetchStatus(command.url)));
    break;
  case 'validate':
    finish(await validate(command.path));
    break;
  case 'load':
    finish(await load(command));
    break;
  case 'export':
    finish(await exportSubject(command));
    break;
  default: {
    const unhandled: never = command;
    throw new Error(`Unhandled command: ${JSON.stringify(unhandled)}`);
  }
}
