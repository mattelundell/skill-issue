import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('fills in loopback defaults when only the password file is given', () => {
    expect(parseEnv({ DB_PASSWORD_FILE: '/run/secrets/db_password' })).toEqual({
      ok: true,
      value: {
        HOST: '127.0.0.1',
        PORT: 4747,
        DB_HOST: '127.0.0.1',
        DB_PORT: 5432,
        DB_NAME: 'skill_issue',
        DB_USER: 'skill_issue',
        DB_PASSWORD_FILE: '/run/secrets/db_password',
      },
    });
  });

  it('reads numbers from their text form and keeps the web folder', () => {
    const result = parseEnv({ DB_PASSWORD_FILE: '/p', PORT: '8080', DB_PORT: '6543', WEB_DIR: '/app/web' });
    expect(result).toMatchObject({ ok: true, value: { PORT: 8080, DB_PORT: 6543, WEB_DIR: '/app/web' } });
  });

  it('names the missing password file', () => {
    const result = parseEnv({});
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-environment' } });
    expect(result.ok ? [] : result.error.issues.map((issue) => issue.variable)).toEqual(['DB_PASSWORD_FILE']);
  });

  it.each(['0', '70000', 'http'])('names PORT when it is %j', (port) => {
    const result = parseEnv({ DB_PASSWORD_FILE: '/p', PORT: port });
    expect(result.ok ? [] : result.error.issues.map((issue) => issue.variable)).toEqual(['PORT']);
  });
});
