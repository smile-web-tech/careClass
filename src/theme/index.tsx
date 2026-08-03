/**
 * Theme context.
 *
 * The teacher picks light, dark, or system; `system` follows the OS and keeps
 * following it as it changes (Android auto-dark at sunset, iOS scheduled
 * appearance). The choice is written to AsyncStorage so it survives a restart.
 *
 * Screens must not build styles at module scope any more — a `StyleSheet.create`
 * evaluated on import captures one palette forever and cannot respond to the
 * switch. Use `useThemedStyles(makeStyles)` instead; see the note on that hook.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import { themes, type Scheme, type Theme } from './tokens';

export * from './tokens';

/** What the teacher chose, which is not the same as what is on screen. */
export type ThemePref = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'classcare.theme';

type ThemeContextValue = Theme & {
  /** The stored preference. */
  pref: ThemePref;
  /** The scheme actually rendering, after resolving `system`. */
  scheme: Scheme;
  setPref: (pref: ThemePref) => void;
  /** False until the stored preference has been read back. */
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('system');
  const [ready, setReady] = useState(false);
  // Guards against a slow disk read landing after the teacher has already
  // tapped a different option and clobbering their choice.
  const touched = useRef(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!alive || touched.current) return;
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPrefState(stored);
        }
      })
      .catch(() => {
        // A theme is not worth failing to launch over — fall back to system.
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setPref = useCallback((next: ThemePref) => {
    touched.current = true;
    setPrefState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Non-fatal: the switch still applies for this session.
    });
  }, []);

  const scheme: Scheme = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;

  const value = useMemo<ThemeContextValue>(
    () => ({ ...themes[scheme], pref, scheme, setPref, ready }),
    [scheme, pref, setPref, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/**
 * Build a stylesheet from the active theme.
 *
 * `factory` must be declared at module scope so its identity is stable —
 * defining it inline in a component rebuilds every StyleSheet on every render.
 * Results are cached per (factory, scheme), so switching back and forth is free
 * and the two palettes are only ever built once each.
 */
const styleCache = new WeakMap<object, Partial<Record<Scheme, unknown>>>();

export function useThemedStyles<T>(factory: (t: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => {
    let perScheme = styleCache.get(factory);
    if (!perScheme) {
      perScheme = {};
      styleCache.set(factory, perScheme);
    }
    if (!perScheme[theme.scheme]) perScheme[theme.scheme] = factory(theme);
    return perScheme[theme.scheme] as T;
  }, [factory, theme]);
}
