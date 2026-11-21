#!/usr/bin/env node
// Proves the linter still enforces what it is configured to enforce.
//
// A linter that has quietly stopped checking something exits 0, exactly as it
// does on clean code. So each `lint-fixtures` folder holds deliberate
// violations, and every violating line states the rule that must report it:
//
//   const x = y as string; // expect: typescript/consistent-type-assertions
//
// and, where the reported line cannot carry a comment of its own, the line
// after it does:
//
//   }, []); // expect-above: react-hooks/exhaustive-deps
//
// This script lints the fixtures and fails unless the linter reports exactly
// the marked lines with exactly the marked rules: a rule that has gone silent
// is listed as missing, and anything unmarked as unexpected.

import { spawnSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const UNUSED_DIRECTIVE = 'unused-disable-directive';
const MARKER = /\/\/ (expect|expect-above): (.+)$/;

/** One finding as `file:line rule`, the form both sides are compared in. */
type Finding = string;

interface Diagnostic {
  readonly file: string;
  readonly line: number;
  readonly code: string | undefined;
  readonly message: string;
  readonly help: string | undefined;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const textOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** The line of a diagnostic's first label; 0 where it has none, as for a configuration error. */
function lineOf(labels: unknown): number {
  const first: unknown = Array.isArray(labels) ? labels[0] : undefined;
  const span = isRecord(first) ? first['span'] : undefined;
  const line = isRecord(span) ? span['line'] : undefined;
  return typeof line === 'number' ? line : 0;
}

/** The diagnostics in the linter's JSON report. Throws if the output is not such a report. */
function parseReport(output: string): readonly Diagnostic[] {
  const report: unknown = JSON.parse(output);
  if (!isRecord(report) || !Array.isArray(report['diagnostics'])) {
    throw new TypeError('the output has no "diagnostics" list');
  }
  return report['diagnostics'].map((entry: unknown): Diagnostic => {
    const file = isRecord(entry) ? textOf(entry['filename']) : undefined;
    const message = isRecord(entry) ? textOf(entry['message']) : undefined;
    if (!isRecord(entry) || file === undefined || message === undefined) {
      throw new TypeError(`a diagnostic has no filename or message: ${JSON.stringify(entry)}`);
    }
    return { file, message, line: lineOf(entry['labels']), code: textOf(entry['code']), help: textOf(entry['help']) };
  });
}

/** `typescript(no-explicit-any)`, as the linter prints it, becomes `typescript/no-explicit-any`. */
function ruleOf(diagnostic: Diagnostic): string {
  const code = /^([\w-]+)\(([\w-]+)\)$/.exec(diagnostic.code ?? '');
  if (code !== null) {
    return `${code[1]}/${code[2]}`;
  }
  if (diagnostic.message.startsWith('Unused oxlint-disable directive')) {
    return UNUSED_DIRECTIVE;
  }
  // Anything else — a configuration or tsconfig error — is shown as it came.
  return [diagnostic.code ?? 'no-code', diagnostic.message, diagnostic.help ?? ''].join(' ').trim();
}

/** Every marker in the fixtures. */
function expectedFindings(files: readonly string[]): ReadonlySet<Finding> {
  const findings = new Set<Finding>();
  for (const file of files) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    for (const [index, text] of lines.entries()) {
      const marker = MARKER.exec(text);
      if (marker === null) {
        continue;
      }
      const line = marker[1] === 'expect-above' ? index : index + 1;
      for (const rule of (marker[2] ?? '').split(',')) {
        findings.add(`${file}:${line} ${rule.trim()}`);
      }
    }
  }
  return findings;
}

/** Everything the linter reports on the fixtures. */
function reportedFindings(folders: readonly string[]): ReadonlySet<Finding> {
  const run = spawnSync(
    join(root, 'node_modules', '.bin', 'oxlint'),
    ['--config', '.oxlintrc.fixtures.json', '--format', 'json', ...folders],
    { cwd: root, encoding: 'utf8' },
  );
  if (run.error !== undefined) {
    throw run.error;
  }
  try {
    return new Set(parseReport(run.stdout).map((diagnostic) => `${diagnostic.file}:${diagnostic.line} ${ruleOf(diagnostic)}`));
  } catch (cause) {
    throw new Error(`The linter did not print a report.\nstdout: ${run.stdout}\nstderr: ${run.stderr}`, { cause });
  }
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const folders = globSync('{apps,packages}/*/lint-fixtures', { cwd: root }).toSorted(byText);
const files = globSync('{apps,packages}/*/lint-fixtures/**/*.{ts,tsx}', { cwd: root }).toSorted(byText);
if (files.length === 0) {
  throw new Error('No lint fixtures were found, so nothing was checked.');
}

const expected = expectedFindings(files);
const reported = reportedFindings(folders);
const missing = [...expected].filter((finding) => !reported.has(finding)).toSorted(byText);
const unexpected = [...reported].filter((finding) => !expected.has(finding)).toSorted(byText);

if (missing.length > 0) {
  process.stderr.write(`Marked in a fixture but not reported — the rule is off or no longer works:\n  ${missing.join('\n  ')}\n`);
}
if (unexpected.length > 0) {
  process.stderr.write(`Reported but not marked in a fixture:\n  ${unexpected.join('\n  ')}\n`);
}
if (missing.length > 0 || unexpected.length > 0) {
  process.exitCode = 1;
} else {
  process.stdout.write(`Lint rules confirmed on the fixtures:\n  ${[...expected].toSorted(byText).join('\n  ')}\n`);
}
