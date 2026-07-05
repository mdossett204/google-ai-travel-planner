import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Run cleanup after each test case to unmount React trees that were mounted with render
afterEach(() => {
  cleanup();
});
