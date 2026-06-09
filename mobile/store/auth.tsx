// Auth state (Phase 4): holds the JWT + current user, persisted in SecureStore.
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getMe,
  login as apiLogin,
  register as apiRegister,
  requestVerification as apiRequestVerification,
  setAuthToken,
  type AuthUser,
} from "../services/api";

// SecureStore keys allow only [A-Za-z0-9._-] — no "/".
const TOKEN_KEY = "grammar_dojo_token";

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

  // Apply a token everywhere (api client + state + secure storage).
  const apply = useCallback(async (newToken: string | null) => {
    setAuthToken(newToken);
    setToken(newToken);
    if (newToken) await SecureStore.setItemAsync(TOKEN_KEY, newToken);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  // Restore a saved session on launch; drop it if the token is no longer valid.
  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (saved) {
          setAuthToken(saved);
          const me = await getMe(); // 401 → throws → treated as logged out
          setToken(saved);
          setUser(me);
        }
      } catch {
        await apply(null);
        setUser(null);
      } finally {
        setReady(true);
      }
    })();
  }, [apply]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { access_token } = await apiLogin(email.trim(), password);
      await apply(access_token);
      setUser(await getMe());
    },
    [apply]
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const { access_token } = await apiRegister(email.trim(), password);
      await apply(access_token);
      setUser(await getMe());
    },
    [apply]
  );

  const logout = useCallback(async () => {
    await apply(null);
    setUser(null);
  }, [apply]);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await getMe());
    } catch {
      // ignore; a stale/expired session is handled by the normal 401 path elsewhere
    }
  }, []);

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
