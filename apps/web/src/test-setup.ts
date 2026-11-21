import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Each test starts from an empty page at the start route.
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});
