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
  googleLogin as apiGoogleLogin,
  login as apiLogin,
  register as apiRegister,
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
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
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

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      const { access_token } = await apiGoogleLogin(idToken);
      await apply(access_token);
      setUser(await getMe());
    },
    [apply]
  );

  const logout = useCallback(async () => {
    await apply(null);
    setUser(null);
  }, [apply]);

  const value = useMemo<AuthContextValue>(
    () => ({ ready, token, user, login, register, loginWithGoogle, logout }),
    [ready, token, user, login, register, loginWithGoogle, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
