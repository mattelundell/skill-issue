import { z } from 'zod';
import { ContentFaultSchema } from './content.js';

export * from './content.js';
export * from './reader.js';
export * from './result.js';

/** Identifier of a module; also the path segment its API routes are mounted under. */
export const ModuleIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

/**
 * Answer of the health endpoint. The two shapes are distinguished by `status`,
 * so a reader can never see "ok" together with a database that is down.
 */
export const HealthResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    version: z.string(),
    database: z.literal('up'),
    modules: z.array(ModuleIdSchema).readonly(),
  }),
  z.object({
    status: z.literal('unavailable'),
    version: z.string(),
    database: z.literal('down'),
  }),
]);
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Error body of every failed API call, after RFC 9457 (problem details). */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  /** Every fault found in rejected content, not only the first. */
  faults: z.array(ContentFaultSchema).optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

export const API_PREFIX = '/api/v1';
