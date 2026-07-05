import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // argon2 hashing + DB truncation make some tests legitimately slow
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
