import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform } from 'react-native';

/**
 * How glass is rendered, decided once for the whole app.
 *
 * The entire design is glassmorphism, and blur is the single biggest performance risk in the
 * project: Home alone stacks five-plus blurred rows, a segmented control and a FAB. Android's
 * blur (`dimezisBlurView`) is real but expensive, so every glass surface routes through this
 * one switch rather than each screen deciding for itself.
 *
 * Phase 10 wires `forceFallback` to a device-capability check. For now it is a manual
 * override so the degraded path can be exercised on demand.
 */
export type GlassBackend =
  /** Apple's native Liquid Glass (iOS 26+) — exactly the material the design doc names. */
  | 'liquid'
  /** expo-blur. Real backdrop blur on both platforms; costly on Android. */
  | 'blur'
  /** Opaque tinted fill. No blur, no compositing cost. */
  | 'fallback';

let forced: GlassBackend | null = null;

/** Override the backend at runtime — used by the kitchen sink to compare all three. */
export function forceGlassBackend(backend: GlassBackend | null): void {
  forced = backend;
}

export function getGlassBackend(): GlassBackend {
  if (forced) return forced;

  // The library's own capability check, rather than parsing an OS version string — it knows
  // about the cases we don't. Returns false on Android.
  if (isLiquidGlassAvailable()) return 'liquid';

  if (Platform.OS === 'ios') return 'blur';

  if (Platform.OS === 'android') {
    // dimezisBlurView needs RenderEffect, which is API 31 (Android 12).
    return typeof Platform.Version === 'number' && Platform.Version >= 31 ? 'blur' : 'fallback';
  }

  return 'fallback';
}

/**
 * Android's blur needs an explicit experimental method or it silently renders a flat tint.
 * Kept here so no component has to remember it.
 */
export const ANDROID_BLUR_METHOD = 'dimezisBlurView' as const;
