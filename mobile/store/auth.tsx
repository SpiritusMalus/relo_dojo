// Auth state (Phase 4): holds the JWT + current user, persisted in SecureStore.
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  getMe,
  login as apiLogin,
  register as apiRegister,
  requestVerification as apiRequestVerification,
  setAuthToken,
  type AuthUser,
} from "../services/api";
import { syncConsentToServer } from "./consent";

// SecureStore keys allow only [A-Za-z0-9._-] — no "/".
const TOKEN_KEY = "relo_dojo_token";

type AuthContextValue = {
  ready: boolean; // false until we've checked storage for a saved token
  token: string | null;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch the current user (e.g. after the email link is opened) to pick up is_verified. */
  refreshUser: () => Promise<void>;
  /** Resend the activation email to the logged-in user. */
  resendVerification: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const sessionVersion = useRef(0);

  // Apply a token everywhere (api client + state + secure storage).
  const apply = useCallback(async (newToken: string | null) => {
    sessionVersion.current += 1;
    setAuthToken(newToken);
    setToken(newToken);
    if (newToken) await SecureStore.setItemAsync(TOKEN_KEY, newToken);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  // Storage is the startup gate. A slow/offline server must not hide the whole app
  // or erase saved credentials; only an explicit 401 establishes an invalid session.
  useEffect(() => {
    let disposed = false;
    const version = sessionVersion.current;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (disposed || version !== sessionVersion.current) return;
        if (saved) {
          setAuthToken(saved);
          setToken(saved);
          setReady(true);
          try {
            const me = await getMe();
            if (!disposed && version === sessionVersion.current) setUser(me);
          } catch (error) {
            if (!disposed && version === sessionVersion.current && error instanceof ApiError && error.status === 401) {
              await apply(null);
              setUser(null);
            }
          }
        }
      } catch {
        // A SecureStore read failure is recoverable; do not destroy data we could not read.
      } finally {
        if (!disposed) setReady(true);
      }
    })();
    return () => { disposed = true; };
  }, [apply]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { access_token } = await apiLogin(email.trim(), password);
      await apply(access_token);
      setUser(await getMe());
      void syncConsentToServer(); // replay a consent accepted while anonymous (audit trail)
    },
    [apply]
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const { access_token } = await apiRegister(email.trim(), password);
      await apply(access_token);
      setUser(await getMe());
      void syncConsentToServer(); // replay a consent accepted while anonymous (audit trail)
    },
    [apply]
  );

  const logout = useCallback(async () => {
    await apply(null);
    setUser(null);
  }, [apply]);

  const refreshUser = useCallback(async () => {
    const version = sessionVersion.current;
    try {
      const me = await getMe();
      if (version === sessionVersion.current) setUser(me);
    } catch (error) {
      if (version === sessionVersion.current && error instanceof ApiError && error.status === 401) {
        await apply(null);
        setUser(null);
      }
    }
  }, [apply]);

  useEffect(() => {
    if (!ready || !token) return;
    // A session restored offline is revalidated when the learner returns. A temporary
    // outage never needs a fresh login just to recover the account display.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshUser();
    });
    return () => subscription.remove();
  }, [ready, token, refreshUser]);

  const resendVerification = useCallback(async () => {
    await apiRequestVerification();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ready, token, user, login, register, logout, refreshUser, resendVerification }),
    [ready, token, user, login, register, logout, refreshUser, resendVerification]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
