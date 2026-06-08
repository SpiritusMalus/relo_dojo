// Language store. Russian is the default; English is opt-in via Settings. The choice is persisted in
// AsyncStorage and also pushed to the API layer (setApiLang) so the backend can return LLM
// explanations in the chosen language. `t(key, vars)` never throws — it falls back to English, then
// to the raw key, and interpolates {placeholders}.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { setApiLang } from "../services/api";
import { STRINGS, type Lang, type StringKey } from "../i18n/strings";

const STORAGE_KEY = "grammar-dojo/lang/v1";
const DEFAULT_LANG: Lang = "ru";

type Vars = Record<string, string | number>;
type I18nCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Vars) => string;
  ready: boolean;
};

const Context = createContext<I18nCtx | null>(null);

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        const l: Lang = v === "en" || v === "ru" ? v : DEFAULT_LANG;
        if (!active) return;
        setLangState(l);
        setApiLang(l);
      })
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setApiLang(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
  }, []);

  const t = useCallback(
    (key: StringKey, vars?: Vars) => {
      const s = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
      return interpolate(s, vars);
    },
    [lang]
  );

  return <Context.Provider value={{ lang, setLang, t, ready }}>{children}</Context.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
