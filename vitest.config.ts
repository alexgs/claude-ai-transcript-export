import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Tests never read a real export. Every fixture export is built from
    // checked-in JSON into a temp directory. See docs/plans §0.2.
    environment: 'node',
  },
});
