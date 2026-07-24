import { defineConfig } from 'vitest/config';

// Only pure modules are tested here — anything importing react-native needs jest-expo, which
// arrives with component tests in a later phase. rippleMath.ts is deliberately dependency-free
// so the motion curve can be verified without a device.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
