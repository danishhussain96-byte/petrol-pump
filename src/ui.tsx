import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { num, parseNum } from './utils';

export const C = {
  primary: '#0B5FA5',
  primaryDark: '#084577',
  accent: '#F28C28',
  bg: '#F2F5F9',
  card: '#FFFFFF',
  text: '#16202B',
  muted: '#667685',
  border: '#D9E1EA',
  green: '#1E8E3E',
  red: '#C62828',
  chip: '#E6EEF6',
};

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={[s.screen, { padding: 12 }]}>{children}</View>;
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Header({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.header, { paddingTop: insets.top + 10 }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={{ paddingRight: 12 }}>
          <Text style={s.headerBack}>‹</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={s.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={s.headerSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ title, right, children, style }: { title?: string; right?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.card, style]}>
      {title || right ? (
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Row({ label, value, bold, color, small }: { label: string; value: string; bold?: boolean; color?: string; small?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, small && { fontSize: 13 }, bold && { fontWeight: '700', color: C.text }]}>{label}</Text>
      <Text style={[s.rowValue, small && { fontSize: 13 }, bold && { fontWeight: '700' }, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: C.border, marginVertical: 6 }} />;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[{ color: C.muted, fontSize: 13 }, style]}>{children}</Text>;
}

/** Numeric input that keeps the typed text while editing (e.g. "12.") but reports numbers. */
export function NumInput({
  value,
  onChange,
  label,
  style,
  placeholder,
  editable = true,
  allowEmpty,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
  placeholder?: string;
  editable?: boolean;
  allowEmpty?: boolean;
}) {
  const fmt = (v: number | undefined) => (v === undefined || (v === 0 && !allowEmpty) ? '' : String(v));
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    const cur = text.trim() === '' ? undefined : parseNum(text);
    if (cur !== value && !(cur === undefined && value === 0)) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <View style={[{ flex: 1 }, style]}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        style={[s.input, !editable && s.inputDisabled]}
        value={text}
        editable={editable}
        keyboardType="decimal-pad"
        placeholder={placeholder ?? '0'}
        placeholderTextColor="#9AA8B5"
        selectTextOnFocus
        onChangeText={(t) => {
          const clean = t.replace(/[^0-9.\-]/g, '');
          setText(clean);
          if (clean.trim() === '') onChange(allowEmpty ? undefined : 0);
          else onChange(parseNum(clean));
        }}
      />
    </View>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  style,
  multiline,
  secure,
  keyboardType,
}: {
  label?: string;
  value: string;
  onChange: (t: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  multiline?: boolean;
  secure?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
}) {
  return (
    <View style={[{ flex: 1 }, style]}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        style={[s.input, multiline && { minHeight: 70, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9AA8B5"
        multiline={multiline}
        secureTextEntry={secure}
        keyboardType={keyboardType}
      />
    </View>
  );
}

export function Btn({
  title,
  onPress,
  kind = 'primary',
  small,
  style,
  disabled,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const bg = { primary: C.primary, secondary: C.chip, danger: C.red, ghost: 'transparent' }[kind];
  const fg = kind === 'secondary' || kind === 'ghost' ? C.primary : '#fff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        small && { paddingVertical: 6, paddingHorizontal: 10 },
        style,
      ]}
    >
      <Text style={[s.btnText, { color: fg }, small && { fontSize: 13 }]}>{title}</Text>
    </Pressable>
  );
}

export function HStack({ children, style, gap = 8 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', gap, alignItems: 'flex-end' }, style]}>{children}</View>;
}

export function Chip({ title, active, onPress }: { title: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { backgroundColor: C.primary }]}>
      <Text style={[s.chipText, active && { color: '#fff' }]}>{title}</Text>
    </Pressable>
  );
}

export function ChipBar<T extends string>({ items, value, onChange }: { items: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingVertical: 8, paddingHorizontal: 12 }}>
      {items.map((i) => (
        <Chip key={i.key} title={i.label} active={i.key === value} onPress={() => onChange(i.key)} />
      ))}
    </ScrollView>
  );
}

export interface Option {
  value: string;
  label: string;
  sub?: string;
}

/** Dropdown-style selector opening a modal list. */
export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  style,
  allowNone,
}: {
  label?: string;
  value: string | undefined;
  options: Option[];
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  allowNone?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const sel = options.find((o) => o.value === value);
  const list = [
    ...(allowNone ? [{ value: '', label: allowNone }] : []),
    ...options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase())),
  ];
  return (
    <View style={[{ flex: 1 }, style]}>
      {label ? <Label>{label}</Label> : null}
      <Pressable style={s.input} onPress={() => setOpen(true)}>
        <Text style={{ color: sel ? C.text : '#9AA8B5', fontSize: 15 }} numberOfLines={1}>
          {sel ? sel.label : value === '' && allowNone ? allowNone : placeholder}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.modalBg} onPress={() => setOpen(false)}>
          <Pressable style={s.modalBox} onPress={() => {}}>
            <Text style={[s.cardTitle, { marginBottom: 8 }]}>{label || 'Select'}</Text>
            {options.length > 8 ? <TextInput style={[s.input, { marginBottom: 8 }]} placeholder="Search…" value={q} onChangeText={setQ} /> : null}
            <FlatList
              data={list}
              keyExtractor={(o) => o.value || '_none'}
              style={{ maxHeight: 420 }}
              ListEmptyComponent={<Muted>Nothing to select. Add items in Setup.</Muted>}
              renderItem={({ item }) => (
                <Pressable
                  style={[s.option, item.value === (value ?? '') && { backgroundColor: C.chip }]}
                  onPress={() => {
                    onChange(item.value === '' && allowNone ? undefined : item.value);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <Text style={{ fontSize: 15, color: C.text }}>{item.label}</Text>
                  {'sub' in item && item.sub ? <Muted>{item.sub}</Muted> : null}
                </Pressable>
              )}
            />
            <Btn title="Close" kind="secondary" onPress={() => setOpen(false)} style={{ marginTop: 8 }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function Stat({ label, value, color, style }: { label: string; value: string; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.stat, style]}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text style={{ color: C.muted, textAlign: 'center', paddingVertical: 12 }}>{text}</Text>;
}

export function ListItem({ title, sub, right, onPress, onDelete }: { title: string; sub?: string; right?: string; onPress?: () => void; onDelete?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.item, pressed && onPress ? { opacity: 0.7 } : null]}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, color: C.text, fontWeight: '600' }}>{title}</Text>
        {sub ? <Muted>{sub}</Muted> : null}
      </View>
      {right ? <Text style={{ fontSize: 15, color: C.text, fontWeight: '600', marginLeft: 8 }}>{right}</Text> : null}
      {onDelete ? (
        <Pressable hitSlop={10} onPress={() => confirm('Delete this entry?', onDelete)} style={{ marginLeft: 12 }}>
          <Text style={{ color: C.red, fontSize: 18 }}>✕</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export function confirm(message: string, onYes: () => void, yesLabel = 'Delete') {
  Alert.alert('Please confirm', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: yesLabel, style: 'destructive', onPress: onYes },
  ]);
}

/** Signed amount text: shows Short/Excess style colouring. */
export function diffColor(n: number): string | undefined {
  if (Math.abs(n) < 0.005) return C.green;
  return n < 0 ? C.red : C.accent;
}

export function diffText(n: number, currency: string): string {
  if (Math.abs(n) < 0.005) return 'Balanced';
  return `${n < 0 ? 'Short' : 'Excess'} ${currency} ${num(Math.abs(n))}`;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.primary, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 19, fontWeight: '700' },
  headerSub: { color: '#D6E6F5', fontSize: 13, marginTop: 2 },
  headerBack: { color: '#fff', fontSize: 34, lineHeight: 34, marginTop: -4 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: C.text, flexShrink: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 8 },
  rowLabel: { color: C.muted, fontSize: 14, flexShrink: 1 },
  rowValue: { color: C.text, fontSize: 14, textAlign: 'right' },
  label: { color: C.muted, fontSize: 12, marginBottom: 4, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 15,
    color: C.text,
    backgroundColor: '#FBFCFE',
    minHeight: 42,
    justifyContent: 'center',
  },
  inputDisabled: { backgroundColor: '#EEF1F4', color: C.muted },
  btn: { borderRadius: 8, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontWeight: '700', fontSize: 15 },
  chip: { backgroundColor: C.chip, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { color: C.primaryDark, fontWeight: '600', fontSize: 14 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalBox: { backgroundColor: '#fff', borderRadius: 14, padding: 16 },
  option: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border, minWidth: 140 },
  statLabel: { color: C.muted, fontSize: 12 },
  statValue: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 4 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEF2F6' },
});
