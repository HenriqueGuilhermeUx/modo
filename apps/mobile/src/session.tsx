import type {
  Dashboard,
  LoginRequest,
  RegisterRequest,
} from "@modo/contracts";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getDashboard,
  login,
  logout,
  register,
} from "./api";

const TOKEN_KEY = "modo.mobile.session";

type SessionContextValue = {
  token: string;
  dashboard: Dashboard | null;
  loading: boolean;
  signIn(input: LoginRequest): Promise<void>;
  signUp(input: RegisterRequest): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<Dashboard | null>;
  updateDashboard(next: Dashboard): void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(async () => {
    setToken("");
    setDashboard(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(TOKEN_KEY)
      .then(async (stored) => {
        if (!stored || !active) return;
        try {
          const current = await getDashboard(stored);
          if (!active) return;
          setToken(stored);
          setDashboard(current);
        } catch {
          await SecureStore.deleteItemAsync(TOKEN_KEY);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const applySession = useCallback(async (nextToken: string) => {
    await SecureStore.setItemAsync(TOKEN_KEY, nextToken, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    const current = await getDashboard(nextToken);
    setToken(nextToken);
    setDashboard(current);
  }, []);

  const signIn = useCallback(async (input: LoginRequest) => {
    const session = await login(input);
    await applySession(session.token);
  }, [applySession]);

  const signUp = useCallback(async (input: RegisterRequest) => {
    const session = await register(input);
    await applySession(session.token);
  }, [applySession]);

  const signOut = useCallback(async () => {
    const currentToken = token;
    await clear();
    if (currentToken) await logout(currentToken);
  }, [clear, token]);

  const refresh = useCallback(async () => {
    if (!token) return null;
    try {
      const current = await getDashboard(token);
      setDashboard(current);
      return current;
    } catch (error) {
      await clear();
      throw error;
    }
  }, [clear, token]);

  const value = useMemo<SessionContextValue>(() => ({
    token,
    dashboard,
    loading,
    signIn,
    signUp,
    signOut,
    refresh,
    updateDashboard: setDashboard,
  }), [dashboard, loading, refresh, signIn, signOut, signUp, token]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession deve ser usado dentro de SessionProvider.");
  return context;
}
