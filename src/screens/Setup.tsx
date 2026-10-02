import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { Alert, Modal, ScrollView, Switch, Text, View } from 'react-native';
import { useLookups } from '../hooks';
import { useStore } from '../store';
import { makeUnit } from '../defaults';
import type { AppData, BankAccount, Customer, DispensingUnit, Nozzle, Product, Salesman } from '../types';
import { Btn, C, Card, ChipBar, Empty, Field, HStack, ListItem, Muted, NumInput, Screen, Select, s, confirm } from '../ui';
import { num, todayStr, uid } from '../utils';

type Tab = 'products' | 'units' | 'nozzles' | 'salesmen' | 'banks' | 'customers' | 'settings';

export function Setup() {
  const [tab, setTab] = useState<Tab>('products');
  return (
    <View style={{ flex: 1 }}>
      <ChipBar
        items={[
          { key: 'products', label: 'Products & rates' },
          { key: 'units', label: 'Dispensers' },
          { key: 'nozzles', label: 'Nozzles' },
          { key: 'salesmen', label: 'Salesmen' },
          { key: 'banks', label: 'Bank accounts' },
          { key: 'customers', label: 'Customers' },
          { key: 'settings', label: 'Settings & backup' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <Screen>
        {tab === 'products' && <Products />}
        {tab === 'units' && <Units />}
        {tab === 'nozzles' && <Nozzles />}
        {tab === 'salesmen' && <Salesmen />}
        {tab === 'banks' && <Banks />}
        {tab === 'customers' && <Customers />}
        {tab === 'settings' && <SettingsView />}
      </Screen>
    </View>
  );
}

type ListKey = 'products' | 'units' | 'nozzles' | 'salesmen' | 'banks' | 'customers';

function useList<K extends ListKey>(key: K) {
  const { data, update } = useStore();
  const items = data[key] as AppData[K];
  const save = (item: AppData[K][number]) =>
    update((d) => {
      const list = d[key] as AppData[K][number][];
      const exists = list.some((x) => x.id === item.id);
      return { ...d, [key]: exists ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item] };
    });
  const remove = (id: string) => update((d) => ({ ...d, [key]: (d[key] as { id: string }[]).filter((x) => x.id !== id) }));
  return { items, save, remove };
}

function EditModal({ title, visible, onClose, onSave, onDelete, children }: { title: string; visible: boolean; onClose: () => void; onSave: () => void; onDelete?: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalBg}>
        <View style={[s.modalBox, { maxHeight: '90%' }]}>
          <Text style={[s.cardTitle, { marginBottom: 4 }]}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
          <HStack style={{ marginTop: 14 }}>
            {onDelete ? <Btn title="Delete" kind="danger" onPress={() => confirm('Delete permanently? Past days that use it will show "—".', onDelete)} /> : null}
            <View style={{ flex: 1 }} />
            <Btn title="Cancel" kind="secondary" onPress={onClose} />
            <Btn title="Save" onPress={onSave} />
          </HStack>
        </View>
      </View>
    </Modal>
  );
}

function ActiveSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <HStack style={{ alignItems: 'center', marginTop: 10 }}>
      <Switch value={value} onValueChange={onChange} />
      <Text style={{ color: C.text }}>{value ? 'Active' : 'Inactive (hidden from entry)'}</Text>
    </HStack>
  );
}

// ---------- Products ----------
function Products() {
  const { items, save, remove } = useList('products');
  const L = useLookups();
  const [ed, setEd] = useState<Product | null>(null);
  const blank = (): Product => ({ id: uid(), name: '', unit: 'L', isFuel: true, rate: 0, costRate: 0, openingStock: 0, capacity: 0, minStock: 0, active: true });
  return (
    <>
      <Card title="Products" right={<Btn title="+ Add" small onPress={() => setEd(blank())} />}>
        {items.map((p) => (
          <ListItem
            key={p.id}
            title={`${p.name}${p.active ? '' : ' (inactive)'}`}
            sub={`${p.isFuel ? 'Fuel' : 'Item'} · cost ${num(p.costRate)} · opening ${num(p.openingStock)} ${p.unit}`}
            right={`${L.cur} ${num(p.rate)}/${p.unit}`}
            onPress={() => setEd(p)}
          />
        ))}
      </Card>
      <Muted>Changing a rate applies to new days. To change a rate for one day, edit it in that day's Meters tab.</Muted>
      {ed ? (
        <EditModal
          title={ed.name || 'New product'}
          visible
          onClose={() => setEd(null)}
          onSave={() => {
            if (!ed.name.trim()) return Alert.alert('Name required');
            save(ed);
            setEd(null);
          }}
          onDelete={items.some((x) => x.id === ed.id) ? () => (remove(ed.id), setEd(null)) : undefined}
        >
          <Field label="Name" value={ed.name} onChange={(t) => setEd({ ...ed, name: t })} />
          <HStack style={{ alignItems: 'center', marginTop: 10 }}>
            <Switch value={ed.isFuel} onValueChange={(v) => setEd({ ...ed, isFuel: v, unit: v ? 'L' : ed.unit === 'L' ? 'pcs' : ed.unit })} />
            <Text style={{ color: C.text }}>{ed.isFuel ? 'Fuel (sold through nozzles)' : 'Lube / item (counter sale)'}</Text>
          </HStack>
          <HStack>
            <Field label="Unit" value={ed.unit} onChange={(t) => setEd({ ...ed, unit: t })} />
            <NumInput label="Sale rate" value={ed.rate} onChange={(v) => setEd({ ...ed, rate: v ?? 0 })} />
            <NumInput label="Cost rate" value={ed.costRate} onChange={(v) => setEd({ ...ed, costRate: v ?? 0 })} />
          </HStack>
          <HStack>
            <NumInput label="Opening stock" value={ed.openingStock} onChange={(v) => setEd({ ...ed, openingStock: v ?? 0 })} />
            <NumInput label="Tank capacity" value={ed.capacity} onChange={(v) => setEd({ ...ed, capacity: v ?? 0 })} />
            <NumInput label="Low-stock alert" value={ed.minStock} onChange={(v) => setEd({ ...ed, minStock: v ?? 0 })} />
          </HStack>
          <Muted style={{ marginTop: 6 }}>Opening stock = stock before the first day you record in this app.</Muted>
          <ActiveSwitch value={ed.active} onChange={(v) => setEd({ ...ed, active: v })} />
        </EditModal>
      ) : null}
    </>
  );
}

// ---------- Dispensing units ----------
function Units() {
  const { data, update } = useStore();
  const { items, save } = useList('units');
  const L = useLookups();
  const [ed, setEd] = useState<DispensingUnit | null>(null);
  const addUnit = () =>
    update((d) => {
      let n = d.units.length + 1;
      while (d.units.some((u) => u.id === `du${n}`)) n++;
      const { unit, nozzles } = makeUnit(n);
      const fuelIds = new Set(d.products.filter((p) => p.isFuel).map((p) => p.id));
      const fallback = d.products.find((p) => p.isFuel)?.id ?? '';
      return {
        ...d,
        units: [...d.units, unit],
        nozzles: [...d.nozzles, ...nozzles.map((z) => (fuelIds.has(z.productId) ? z : { ...z, productId: fallback }))],
      };
    });
  const removeUnit = (id: string) =>
    update((d) => ({
      ...d,
      units: d.units.filter((u) => u.id !== id),
      // Keep the nozzles (they have meter history) but detach them.
      nozzles: d.nozzles.map((z) => (z.unitId === id ? { ...z, unitId: undefined } : z)),
    }));
  const bankLabel = (id?: string, fallback?: string) => (id ? L.bankName(id) : fallback ? `${L.bankName(fallback)} (default)` : 'not posted');
  return (
    <>
      <Card title="Dispensing units" right={<Btn title="+ Add (4 nozzles)" small onPress={addUnit} />}>
        {items.length === 0 ? <Empty text="No dispensers" /> : null}
        {items.map((u) => (
          <ListItem
            key={u.id}
            title={`${u.name}${u.active ? '' : ' (inactive)'}`}
            sub={`${data.nozzles.filter((z) => z.unitId === u.id).length} nozzles · Card → ${bankLabel(u.cardBankId, data.settings.cardBankId)} · Digital → ${bankLabel(u.digitalBankId, data.settings.digitalBankId)}`}
            onPress={() => setEd(u)}
          />
        ))}
      </Card>
      <Muted>Set the bank account each dispenser's POS machine and wallet pay into. Card / digital sales then post to that bank automatically.</Muted>
      {ed ? (
        <EditModal
          title={ed.name || 'Dispenser'}
          visible
          onClose={() => setEd(null)}
          onSave={() => {
            if (!ed.name.trim()) return Alert.alert('Name required');
            save(ed);
            setEd(null);
          }}
          onDelete={items.some((x) => x.id === ed.id) ? () => (removeUnit(ed.id), setEd(null)) : undefined}
        >
          <Field label="Name" value={ed.name} onChange={(t) => setEd({ ...ed, name: t })} />
          <Select label="Card (POS) sales go to" value={ed.cardBankId} options={L.opt.banks} allowNone="— Use default from Settings —" onChange={(v) => setEd({ ...ed, cardBankId: v })} />
          <Select label="Digital / online sales go to" value={ed.digitalBankId} options={L.opt.banks} allowNone="— Use default from Settings —" onChange={(v) => setEd({ ...ed, digitalBankId: v })} />
          {L.opt.banks.length === 0 ? <Muted style={{ marginTop: 6 }}>Add bank accounts first (Setup → Bank accounts).</Muted> : null}
          <ActiveSwitch value={ed.active} onChange={(v) => setEd({ ...ed, active: v })} />
        </EditModal>
      ) : null}
    </>
  );
}

// ---------- Nozzles ----------
function Nozzles() {
  const { data } = useStore();
  const { items, save, remove } = useList('nozzles');
  const L = useLookups();
  const [ed, setEd] = useState<Nozzle | null>(null);
  const fuels = L.opt.products.filter((o) => L.product.get(o.value)?.isFuel);
  const groups = [...data.units.map((u) => ({ id: u.id as string | undefined, name: u.name })), { id: undefined, name: 'No dispenser' }]
    .map((g) => ({ ...g, nozzles: items.filter((n) => (g.id ? n.unitId === g.id : !n.unitId || !L.unit.has(n.unitId))) }))
    .filter((g) => g.nozzles.length > 0 || g.id);
  return (
    <>
      {groups.map((g) => (
        <Card
          key={g.id ?? 'none'}
          title={g.name}
          right={
            <Btn
              title="+ Nozzle"
              small
              onPress={() => setEd({ id: uid(), name: `${g.name} N${g.nozzles.length + 1}`, productId: fuels[0]?.value ?? '', unitId: g.id, openingReading: 0, active: true })}
            />
          }
        >
          {g.nozzles.length === 0 ? <Empty text="No nozzles" /> : null}
          {g.nozzles.map((n) => (
            <ListItem key={n.id} title={`${n.name}${n.active ? '' : ' (inactive)'}`} sub={L.productName(n.productId)} right={`Opening ${num(n.openingReading)}`} onPress={() => setEd(n)} />
          ))}
        </Card>
      ))}
      <Muted>Opening reading is used only for the first day. After that, each day's opening is the previous day's closing.</Muted>
      {ed ? (
        <EditModal
          title={ed.name || 'Nozzle'}
          visible
          onClose={() => setEd(null)}
          onSave={() => {
            if (!ed.name.trim() || !ed.productId) return Alert.alert('Name and product required');
            save(ed);
            setEd(null);
          }}
          onDelete={items.some((x) => x.id === ed.id) ? () => (remove(ed.id), setEd(null)) : undefined}
        >
          <Field label="Name" value={ed.name} onChange={(t) => setEd({ ...ed, name: t })} />
          <Select label="Dispensing unit" value={ed.unitId} options={L.opt.units} allowNone="— None —" onChange={(v) => setEd({ ...ed, unitId: v })} />
          <Select label="Product" value={ed.productId} options={fuels} onChange={(v) => setEd({ ...ed, productId: v ?? '' })} />
          <NumInput label="Opening meter reading" value={ed.openingReading} onChange={(v) => setEd({ ...ed, openingReading: v ?? 0 })} />
          <ActiveSwitch value={ed.active} onChange={(v) => setEd({ ...ed, active: v })} />
        </EditModal>
      ) : null}
    </>
  );
}

// ---------- Salesmen ----------
function Salesmen() {
  const { items, save, remove } = useList('salesmen');
  const [ed, setEd] = useState<Salesman | null>(null);
  return (
    <>
      <Card title="Salesmen" right={<Btn title="+ Add" small onPress={() => setEd({ id: uid(), name: '', phone: '', active: true })} />}>
        {items.length === 0 ? <Empty text="No salesmen" /> : null}
        {items.map((x) => (
          <ListItem key={x.id} title={`${x.name}${x.active ? '' : ' (inactive)'}`} sub={x.phone} onPress={() => setEd(x)} />
        ))}
      </Card>
      {ed ? (
        <EditModal
          title={ed.name || 'New salesman'}
          visible
          onClose={() => setEd(null)}
          onSave={() => {
            if (!ed.name.trim()) return Alert.alert('Name required');
            save(ed);
            setEd(null);
          }}
          onDelete={items.some((x) => x.id === ed.id) ? () => (remove(ed.id), setEd(null)) : undefined}
        >
          <Field label="Name" value={ed.name} onChange={(t) => setEd({ ...ed, name: t })} />
          <Field label="Phone" value={ed.phone} keyboardType="phone-pad" onChange={(t) => setEd({ ...ed, phone: t })} />
          <ActiveSwitch value={ed.active} onChange={(v) => setEd({ ...ed, active: v })} />
        </EditModal>
      ) : null}
    </>
  );
}

// ---------- Banks ----------
function Banks() {
  const { items, save, remove } = useList('banks');
  const [ed, setEd] = useState<BankAccount | null>(null);
  return (
    <>
      <Card title="Bank accounts" right={<Btn title="+ Add" small onPress={() => setEd({ id: uid(), name: '', accountNo: '', openingBalance: 0, active: true })} />}>
        {items.length === 0 ? <Empty text="No bank accounts" /> : null}
        {items.map((x) => (
          <ListItem key={x.id} title={`${x.name}${x.active ? '' : ' (inactive)'}`} sub={x.accountNo} right={`Opening ${num(x.openingBalance)}`} onPress={() => setEd(x)} />
        ))}
      </Card>
      {ed ? (
        <EditModal
          title={ed.name || 'New bank account'}
          visible
          onClose={() => setEd(null)}
          onSave={() => {
            if (!ed.name.trim()) return Alert.alert('Name required');
            save(ed);
            setEd(null);
          }}
          onDelete={items.some((x) => x.id === ed.id) ? () => (remove(ed.id), setEd(null)) : undefined}
        >
          <Field label="Bank name" value={ed.name} onChange={(t) => setEd({ ...ed, name: t })} />
          <Field label="Account number / title" value={ed.accountNo} onChange={(t) => setEd({ ...ed, accountNo: t })} />
          <NumInput label="Opening balance" value={ed.openingBalance} onChange={(v) => setEd({ ...ed, openingBalance: v ?? 0 })} />
          <ActiveSwitch value={ed.active} onChange={(v) => setEd({ ...ed, active: v })} />
        </EditModal>
      ) : null}
    </>
  );
}

// ---------- Customers ----------
function Customers() {
  const { items, save, remove } = useList('customers');
  const [ed, setEd] = useState<Customer | null>(null);
  return (
    <>
      <Card title="Credit customers" right={<Btn title="+ Add" small onPress={() => setEd({ id: uid(), name: '', phone: '', vehicleNo: '', openingBalance: 0, creditLimit: 0, active: true })} />}>
        {items.length === 0 ? <Empty text="No customers" /> : null}
        {items.map((x) => (
          <ListItem key={x.id} title={`${x.name}${x.active ? '' : ' (inactive)'}`} sub={[x.phone, x.vehicleNo].filter(Boolean).join(' · ')} right={`Opening ${num(x.openingBalance)}`} onPress={() => setEd(x)} />
        ))}
      </Card>
      {ed ? (
        <EditModal
          title={ed.name || 'New customer'}
          visible
          onClose={() => setEd(null)}
          onSave={() => {
            if (!ed.name.trim()) return Alert.alert('Name required');
            save(ed);
            setEd(null);
          }}
          onDelete={items.some((x) => x.id === ed.id) ? () => (remove(ed.id), setEd(null)) : undefined}
        >
          <Field label="Name / company" value={ed.name} onChange={(t) => setEd({ ...ed, name: t })} />
          <HStack>
            <Field label="Phone" value={ed.phone} keyboardType="phone-pad" onChange={(t) => setEd({ ...ed, phone: t })} />
            <Field label="Vehicle #" value={ed.vehicleNo} onChange={(t) => setEd({ ...ed, vehicleNo: t })} />
          </HStack>
          <HStack>
            <NumInput label="Opening balance (owes)" value={ed.openingBalance} onChange={(v) => setEd({ ...ed, openingBalance: v ?? 0 })} />
            <NumInput label="Credit limit" value={ed.creditLimit} onChange={(v) => setEd({ ...ed, creditLimit: v ?? 0 })} />
          </HStack>
          <ActiveSwitch value={ed.active} onChange={(v) => setEd({ ...ed, active: v })} />
        </EditModal>
      ) : null}
    </>
  );
}

// ---------- Settings & backup ----------
function SettingsView() {
  const { data, update, replaceAll } = useStore();
  const L = useLookups();
  const st = data.settings;
  const set = (patch: Partial<typeof st>) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));

  const backup = async () => {
    try {
      const file = new File(Paths.cache, `petrol-pump-backup-${todayStr()}.json`);
      if (file.exists) file.delete();
      file.create();
      file.write(JSON.stringify(data));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save backup' });
    } catch (e) {
      Alert.alert('Backup failed', String(e));
    }
  };
  const restore = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const text = await new File(res.assets[0].uri).text();
      const parsed = JSON.parse(text) as AppData;
      if (!parsed || typeof parsed !== 'object' || !parsed.settings) throw new Error('Not a valid backup file');
      Alert.alert('Restore backup?', `This replaces ALL current data with the backup (${Object.keys(parsed.days || {}).length} days).`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', style: 'destructive', onPress: () => replaceAll(parsed) },
      ]);
    } catch (e) {
      Alert.alert('Restore failed', String(e));
    }
  };

  return (
    <>
      <Card title="Station">
        <Field label="Station name" value={st.stationName} onChange={(t) => set({ stationName: t })} />
        <Field label="Address" value={st.address} onChange={(t) => set({ address: t })} />
        <HStack>
          <Field label="Phone" value={st.phone} onChange={(t) => set({ phone: t })} />
          <Field label="Currency" value={st.currency} onChange={(t) => set({ currency: t })} style={{ maxWidth: 90 }} />
        </HStack>
        <NumInput label="Opening cash in hand (before first day)" value={st.openingCash} onChange={(v) => set({ openingCash: v ?? 0 })} />
      </Card>
      <Card title="Default card & digital accounts">
        <Muted>Default accounts. A dispenser with its own bank account (Setup → Dispensers) uses that instead.</Muted>
        <Select label="Card (POS) sales go to" value={st.cardBankId} options={L.opt.banks} allowNone="— Don't post to bank —" onChange={(v) => set({ cardBankId: v })} />
        <Select label="Digital / online sales go to" value={st.digitalBankId} options={L.opt.banks} allowNone="— Don't post to bank —" onChange={(v) => set({ digitalBankId: v })} />
      </Card>
      <Card title="App lock">
        <Field label="PIN (leave empty for no lock)" value={st.pin} secure keyboardType="number-pad" onChange={(t) => set({ pin: t.replace(/\D/g, '').slice(0, 6) })} />
        <Muted style={{ marginTop: 6 }}>The PIN is asked every time the app opens.</Muted>
      </Card>
      <Card title="Backup & restore">
        <Muted>Data is stored on this phone only. Take a backup regularly and save it to Google Drive / WhatsApp / email.</Muted>
        <HStack style={{ marginTop: 10 }}>
          <Btn title="⬆ Backup" onPress={backup} style={{ flex: 1 }} />
          <Btn title="⬇ Restore" kind="secondary" onPress={restore} style={{ flex: 1 }} />
        </HStack>
      </Card>
      <Muted>{Object.keys(data.days).length} days recorded.</Muted>
    </>
  );
}
