import { BlurTargetView } from 'expo-blur';
import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

/**
 * Android's blur does not sample the window automatically — it needs to be told which view
 * hierarchy to treat as its backdrop, via a `BlurTargetView` ref. (iOS samples the window
 * itself and ignores this entirely.)
 *
 * So the app wraps its content in one target and hands the ref down through context, rather
 * than every glass surface inventing its own. Without this, `blurMethod` silently degrades to
 * `'none'` and every glass panel renders as a flat translucent rectangle — which is exactly
 * what happened on the first run of the kitchen sink.
 */
const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

export function BlurTargetProvider({ children }: { children: ReactNode }) {
  const ref = useRef<View | null>(null);

  // iOS/Web don't need a target; skip the extra native view entirely.
  if (Platform.OS !== 'android') {
    return <BlurTargetContext.Provider value={null}>{children}</BlurTargetContext.Provider>;
  }

  return (
    <BlurTargetContext.Provider value={ref}>
      <BlurTargetView ref={ref} style={styles.fill}>
        {children}
      </BlurTargetView>
    </BlurTargetContext.Provider>
  );
}

export function useBlurTarget(): RefObject<View | null> | undefined {
  return useContext(BlurTargetContext) ?? undefined;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
