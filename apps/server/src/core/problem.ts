import { ProblemSchema, type ContentFault, type Problem } from '@skill-issue/contract';

/** The body of every failed API call, after RFC 9457 (problem details). */
export const problem = (status: number, title: string, detail?: string, faults?: readonly ContentFault[]): Problem => ({
  type: 'about:blank',
  title,
  status,
  ...(detail === undefined ? {} : { detail }),
  ...(faults === undefined ? {} : { faults: [...faults] }),
});

/** How a route documents a problem answer in the API description. */
export const problemContent = { 'application/json': { schema: ProblemSchema } };
