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
  isCurrentAuthToken,
  login as apiLogin,
  register as apiRegister,
  requestVerification as apiRequestVerification,
  setAuthToken,
  type AuthUser,
} from "../services/api";
import { syncConsentToServer } from "./consent";

// SecureStore keys allow only [A-Za-z0-9._-] — no "/".
const TOKEN_KEY = "relo_dojo_token";
// Native writes cannot be cancelled once dispatched. Serialize even across provider remounts so
// an old A write finishes before the logout/B replacement, never after the newer credentials.
let secureStoreWrites: Promise<void> = Promise.resolve();
const IDENTITY_RETRY_INITIAL_MS = 15000;
const IDENTITY_RETRY_MAX_MS = 60000;

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
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const sessionVersion = useRef(0);
  const tokenRef = useRef<string | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const mounted = useRef(true);
  const identityRequest = useRef<{ token: string; version: number; promise: Promise<AuthUser | null> } | null>(null);

  // Apply a token everywhere (api client + state + secure storage).
  const apply = useCallback(async (newToken: string | null) => {
    const version = ++sessionVersion.current;
    setIdentityEpoch(version);
    tokenRef.current = newToken;
    userRef.current = null;
    setAuthToken(newToken);
    setToken(newToken);
    setUser(null);
    const write = secureStoreWrites.then(async () => {
      if (version !== sessionVersion.current || !isCurrentAuthToken(newToken)) return;
      if (newToken) await SecureStore.setItemAsync(TOKEN_KEY, newToken);
      else await SecureStore.deleteItemAsync(TOKEN_KEY);
    });
    secureStoreWrites = write.catch(() => {});
    await write;
    return version;
  }, []);

  // Startup, foreground/manual refresh and retry share a request. A slow /me must not create
  // overlapping reads, and neither a late success nor a late 401 may affect a replacement login.
  const requestIdentity = useCallback((expectedToken: string, version: number): Promise<AuthUser | null> => {
    const current = () => mounted.current && version === sessionVersion.current
      && tokenRef.current === expectedToken && isCurrentAuthToken(expectedToken);
    if (!current()) return Promise.resolve(null);
    const pending = identityRequest.current;
    if (pending?.token === expectedToken && pending.version === version) return pending.promise;
    const request = { token: expectedToken, version, promise: Promise.resolve<AuthUser | null>(null) };
    request.promise = (async () => {
      // Install the in-flight marker before even a synchronously throwing transport can settle.
      await Promise.resolve();
      try {
        if (!current()) return null;
        const me = await getMe();
        if (!current()) return null;
        userRef.current = me;
        setUser(me);
        return me;
      } catch (error) {
        if (current() && error instanceof ApiError && error.status === 401) await apply(null);
        throw error;
      } finally {
        if (identityRequest.current === request) identityRequest.current = null;
      }
    })();
    identityRequest.current = request;
    return request.promise;
  }, [apply]);

  // Storage is the startup gate. A slow/offline server must not hide the whole app
  // or erase saved credentials; only an explicit 401 establishes an invalid session.
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const version = sessionVersion.current;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (disposed || version !== sessionVersion.current) return;
        if (saved) {
          tokenRef.current = saved;
          setAuthToken(saved);
          setToken(saved);
          setReady(true);
          await requestIdentity(saved, version).catch(() => {});
        }
      } catch {
        // A SecureStore read failure is recoverable; do not destroy data we could not read.
      } finally {
        if (!disposed) setReady(true);
      }
    })();
    return () => { disposed = true; mounted.current = false; };
  }, [requestIdentity]);

  const login = useCallback(
    async (email: string, password: string) => {
      const requestVersion = ++sessionVersion.current;
      setIdentityEpoch(requestVersion);
      const { access_token } = await apiLogin(email.trim(), password);
      if (requestVersion !== sessionVersion.current) return;
      const version = await apply(access_token);
      if (version !== sessionVersion.current) return;
      const me = await requestIdentity(access_token, version);
      if (!me || version !== sessionVersion.current) return;
      void syncConsentToServer(); // replay a consent accepted while anonymous (audit trail)
    },
    [apply, requestIdentity]
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const requestVersion = ++sessionVersion.current;
      setIdentityEpoch(requestVersion);
      const { access_token } = await apiRegister(email.trim(), password);
      if (requestVersion !== sessionVersion.current) return;
      const version = await apply(access_token);
      if (version !== sessionVersion.current) return;
      const me = await requestIdentity(access_token, version);
      if (!me || version !== sessionVersion.current) return;
      void syncConsentToServer(); // replay a consent accepted while anonymous (audit trail)
    },
    [apply, requestIdentity]
  );

  const logout = useCallback(async () => {
    await apply(null);
  }, [apply]);

  const refreshUser = useCallback(async () => {
    const expectedToken = tokenRef.current;
    if (!expectedToken) return;
    const version = sessionVersion.current;
    await requestIdentity(expectedToken, version).catch(() => {});
  }, [requestIdentity]);

  useEffect(() => {
    if (!ready || !token) return;
    let stopped = false;
    let foreground = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = IDENTITY_RETRY_INITIAL_MS;
    const version = sessionVersion.current;
    const unknownCurrentUser = () => !stopped && foreground && !userRef.current
      && version === sessionVersion.current && tokenRef.current === token && isCurrentAuthToken(token);
    const clear = () => { if (timer) clearTimeout(timer); timer = null; };
    const schedule = () => {
      if (timer || !unknownCurrentUser()) return;
      timer = setTimeout(() => {
        timer = null;
        if (!unknownCurrentUser()) return;
        void refreshUser().finally(() => {
          delay = Math.min(delay * 2, IDENTITY_RETRY_MAX_MS);
          schedule();
        });
      }, delay);
    };
    // A restored session can come online while the app stays open. Poll only the missing identity
    // with bounded backoff; known users keep the ordinary foreground revalidation behavior.
    schedule();
    const subscription = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      clear();
      if (foreground) {
        delay = IDENTITY_RETRY_INITIAL_MS;
        void refreshUser().finally(schedule);
      }
    });
    return () => { stopped = true; clear(); subscription.remove(); };
  }, [ready, token, user, identityEpoch, refreshUser]);

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
