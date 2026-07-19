import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // argon2 hashing + DB truncation make some tests legitimately slow
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // Integration files all truncate the same test database — running them in
    // parallel makes them destroy each other's fixtures mid-test.
    fileParallelism: false,
  },
});
