import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { carryFor, computeLedger, type Ledger } from './calc';
import { defaultData, newDay, normalize } from './defaults';
import type { AppData, DayRecord } from './types';

const KEY = 'petrol-pump-data-v1';

interface Store {
  data: AppData;
  ledger: Ledger;
  loaded: boolean;
  update: (fn: (d: AppData) => AppData) => void;
  /** Updates a day, creating it (with carried-forward openings) if needed. */
  updateDay: (date: string, fn: (d: DayRecord) => DayRecord) => void;
  getDay: (date: string) => DayRecord;
  replaceAll: (d: AppData) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>(defaultData);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setData(normalize(JSON.parse(raw)));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {});
    }, 400);
  }, [data, loaded]);

  const ledger = useMemo(() => computeLedger(data), [data]);
  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;

  const update = useCallback((fn: (d: AppData) => AppData) => setData((d) => fn(d)), []);

  const updateDay = useCallback((date: string, fn: (d: DayRecord) => DayRecord) => {
    setData((d) => {
      const existing = d.days[date] ?? newDay(d, date, carryFor(d, computeLedger(d), date));
      return { ...d, days: { ...d.days, [date]: fn(existing) } };
    });
  }, []);

  const getDay = useCallback(
    (date: string) => data.days[date] ?? newDay(data, date, carryFor(data, ledgerRef.current, date)),
    [data],
  );

  const replaceAll = useCallback((d: AppData) => setData(normalize(d)), []);

  const value = useMemo(
    () => ({ data, ledger, loaded, update, updateDay, getDay, replaceAll }),
    [data, ledger, loaded, update, updateDay, getDay, replaceAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
