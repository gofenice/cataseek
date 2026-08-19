import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Test files are excluded from tsconfig.app.json so the production build never
  // needs the test devDependencies. That also means esbuild no longer picks up
  // `jsx: react-jsx` from there for these files, so it is set explicitly here.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
  },
});
