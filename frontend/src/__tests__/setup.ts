import '@testing-library/jest-dom';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { expect, afterEach } from 'vitest';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock environment variables for tests
// These must be set before any imports that use config
import.meta.env.VITE_API_URL = 'http://localhost:3001/api';
import.meta.env.VITE_DISCORD_CLIENT_ID = 'test-discord-client-id';
import.meta.env.VITE_ENVIRONMENT = 'development';
import.meta.env.VITE_ENABLE_ANALYTICS = 'false';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
    }),
});

// Mock ResizeObserver for recharts
(globalThis as typeof globalThis & { ResizeObserver: unknown }).ResizeObserver =
    class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    };

// Node 26 defines a `localStorage` global that is undefined unless the
// process runs with --localstorage-file, and that shadows jsdom's Storage.
// Give tests a plain in-memory Storage so theme and consent code can run.
function memoryStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() {
            return store.size;
        },
        clear: () => store.clear(),
        getItem: (key: string) => store.get(String(key)) ?? null,
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        removeItem: (key: string) => {
            store.delete(String(key));
        },
        setItem: (key: string, value: string) => {
            store.set(String(key), String(value));
        },
    } as Storage;
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
    const scope = globalThis as unknown as Record<string, unknown>;
    const current = scope[name] as Partial<Storage> | undefined;
    if (!current || typeof current.getItem !== 'function') {
        const storage = memoryStorage();
        Object.defineProperty(globalThis, name, {
            value: storage,
            configurable: true,
            writable: true,
        });
        if (typeof window !== 'undefined' && (window as unknown) !== globalThis)
            Object.defineProperty(window, name, {
                value: storage,
                configurable: true,
                writable: true,
            });
    }
}
