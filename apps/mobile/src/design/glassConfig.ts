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
    // Deliberately the opaque fallback for now — see ANDROID_BLUR_STATUS below.
    return 'fallback';
  }

  return 'fallback';
}

/**
 * Android blur method. `dimezisBlurViewSdk31Plus` uses RenderEffect where it exists and falls
 * back to a flat tint on older devices by itself, which is what we want — plain
 * `dimezisBlurView` is documented as slow below API 31.
 *
 * This ONLY takes effect alongside a `blurTarget` ref; see design/blurTarget.tsx.
 */
export const ANDROID_BLUR_METHOD = 'dimezisBlurViewSdk31Plus' as const;

/**
 * WHY ANDROID DEFAULTS TO THE OPAQUE FALLBACK
 *
 * On the API 36 emulator (software GPU), a `BlurView` sampling a `BlurTargetView` crashes the
 * process with SIGSEGV on the RenderThread. Isolated carefully: mounting `BlurTargetView` on
 * its own is fine, and the app runs; adding the blur on top of it is what kills it.
 *
 * That is very likely an emulator/SwiftShader limitation rather than a real-device bug, but it
 * cannot be confirmed without physical hardware — so the safe default wins, and blur stays one
 * switch away (`forceGlassBackend('blur')`, or the kitchen sink's backend picker).
 *
 * Worth knowing: over this design's smooth ambient gradient, the blurred and opaque surfaces
 * look nearly identical. The translucent fill, the hairline border and the inner top highlight
 * are what read as glass — the blur contributes far less than expected. So the fallback is a
 * genuinely acceptable shipping state for Android, not a placeholder.
 *
 * TODO(Phase 10): verify on a physical low-end Android device and flip the default if it holds.
 */
export const ANDROID_BLUR_STATUS = 'fallback-pending-device-verification' as const;
