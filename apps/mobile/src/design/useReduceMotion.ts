import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * True when the OS asks for reduced motion. The ripple, the ambient drift and the seal stamp
 * all check this — the design leans hard on motion, so honouring it is not optional.
 */
export function useReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!cancelled) setEnabled(on);
    });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return enabled;
}
