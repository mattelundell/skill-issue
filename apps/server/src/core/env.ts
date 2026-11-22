import { z } from 'zod';
import { err, ok, type Result } from './result.js';

const EnvSchema = z.object({
  /** Interface the server listens on. Loopback unless a container sets otherwise. */
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4747),
  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z.string().min(1).default('skill_issue'),
  DB_USER: z.string().min(1).default('skill_issue'),
  /** Path of a file holding the database password, so the secret is never an environment value. */
  DB_PASSWORD_FILE: z.string().min(1),
  /** Folder with the built browser app. When absent, only the API is served. */
  WEB_DIR: z.string().min(1).optional(),
  /** Folder with the introduction, loaded on the first start of an installation that holds no subject. When absent, nothing is loaded. */
  INTRODUCTION_DIR: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export interface EnvError {
  readonly kind: 'invalid-environment';
  readonly issues: readonly { readonly variable: string; readonly message: string }[];
}

export function parseEnv(source: Readonly<Record<string, string | undefined>>): Result<Env, EnvError> {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err({
    kind: 'invalid-environment',
    issues: parsed.error.issues.map((issue) => ({ variable: issue.path.join('.'), message: issue.message })),
  });
}
