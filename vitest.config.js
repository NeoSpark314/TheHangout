import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: [],
        include: ['src/**/*.test.{js,ts}'],
        coverage: {
            provider: 'v8',
            reportsDirectory: './coverage/engine',
            reporter: ['text', 'html', 'json-summary'],
            all: true,
            include: [
                'src/app/**/*.ts',
                'src/world/**/*.ts',
                'src/physics/**/*.ts',
                'src/network/**/*.ts',
                'src/input/**/*.ts',
                'src/content/runtime/**/*.ts',
                'src/render/runtime/**/*.ts',
                'src/render/effects/**/*.ts',
                'src/render/debug/**/*.ts'
            ],
            exclude: [
                'src/**/*.test.{js,ts}',
                'src/testing/**',
                'src/ui/**',
                'src/content/scenarios/**',
                'src/content/objects/**',
                'src/content/examples/**',
                'src/**/contracts/**',
                'src/**/*.d.ts'
            ]
        }
    },
});
