#!/usr/bin/env node
import { parseCommand, USAGE } from './command.js';
import { fetchStatus, report } from './status.js';

const command = parseCommand(process.argv.slice(2));

switch (command.kind) {
  case 'help':
    process.stdout.write(USAGE);
    break;
  case 'invalid':
    process.stderr.write(`${command.message}\n\n${USAGE}`);
    process.exitCode = 2;
    break;
  case 'status': {
    const { text, exitCode } = report(await fetchStatus(command.url));
    (exitCode === 0 ? process.stdout : process.stderr).write(`${text}\n`);
    process.exitCode = exitCode;
    break;
  }
  default: {
    const unhandled: never = command;
    throw new Error(`Unhandled command: ${JSON.stringify(unhandled)}`);
  }
}
