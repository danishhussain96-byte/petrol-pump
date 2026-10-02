import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  FlatList,
  Keyboard,
  Platform,
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

// ---------------- Keyboard handling ----------------
// Android (edge-to-edge) does not resize the window or popups when the keyboard opens,
// so we track the keyboard ourselves: scroll areas get extra bottom space and scroll the
// focused input into view, and popups sit above the keyboard.

export interface KeyboardState {
  height: number;
  /** Screen Y of the keyboard's top edge (Infinity when hidden). */
  top: number;
}

const HIDDEN: KeyboardState = { height: 0, top: Infinity };

export function useKeyboard(): KeyboardState {
  const [kb, setKb] = useState<KeyboardState>(HIDDEN);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) =>
      setKb({ height: e.endCoordinates.height, top: e.endCoordinates.screenY }),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(HIDDEN));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return kb;
}

/** Lets inputs ask the nearest KeyboardScroll to bring them into view. */
const RevealCtx = createContext<((input: TextInput | null) => void) | null>(null);

function useRevealOnFocus() {
  const reveal = useContext(RevealCtx);
  const ref = useRef<TextInput>(null);
  const onFocus = useCallback(() => reveal?.(ref.current), [reveal]);
  return { ref, onFocus };
}

export function KeyboardScroll({
  children,
  style,
  contentContainerStyle,
  bottomPadding = 0,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  bottomPadding?: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const kb = useKeyboard();
  const kbRef = useRef(kb);
  kbRef.current = kb;
  const offset = useRef(0);

  const reveal = useCallback((input: TextInput | null) => {
    // Wait for the keyboard to finish opening so its position is known.
    setTimeout(() => {
      const sv = scrollRef.current;
      const inner = sv?.getInnerViewNode?.();
      if (!sv || !input || !inner) return;
      const svNode = sv as unknown as View;
      svNode.measureInWindow((_sx, sy, _sw, sh) => {
        // Part of the scroll view not hidden by the keyboard.
        const visible = Math.min(sh, kbRef.current.top - sy) || sh;
        input.measureLayout(
          inner,
          (_x, y, _w, h) => {
            const top = offset.current;
            const bottom = top + visible;
            if (y < top + 8 || y + h > bottom - 16) {
              sv.scrollTo({ y: Math.max(0, y - Math.max(16, (visible - h) / 3)), animated: true });
            }
          },
          () => {},
        );
      });
    }, Platform.OS === 'android' ? 350 : 80);
  }, []);

  return (
    <RevealCtx.Provider value={reveal}>
      <ScrollView
        ref={scrollRef}
        style={style}
        contentContainerStyle={[contentContainerStyle, { paddingBottom: bottomPadding + kb.height }]}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={(e) => (offset.current = e.nativeEvent.contentOffset.y)}
      >
        {children}
      </ScrollView>
    </RevealCtx.Provider>
  );
}

// ---------------- Popups ----------------
// Popups are drawn inside the app's own window (not a native Modal) so keyboard events
// reach them on Android and they can move above the keyboard.

type PortalApi = { set: (id: number, node: React.ReactNode | null) => void };
const PortalCtx = createContext<PortalApi | null>(null);

/** Hosts popups on top of everything inside it. Wrap the whole app once. */
export function PortalHost({ children }: { children: React.ReactNode }) {
  const [layers, setLayers] = useState<Map<number, React.ReactNode>>(new Map());
  const api = useMemo<PortalApi>(
    () => ({
      set: (id, node) =>
        setLayers((prev) => {
          if (node === null && !prev.has(id)) return prev;
          const next = new Map(prev);
          if (node === null) next.delete(id);
          else next.set(id, node);
          return next;
        }),
    }),
    [],
  );
  return (
    <PortalCtx.Provider value={api}>
      {children}
      {[...layers].map(([id, node]) => (
        <View key={id} style={StyleSheet.absoluteFill}>
          {node}
        </View>
      ))}
    </PortalCtx.Provider>
  );
}

let nextPortalId = 1;

/** Drop-in for a transparent Modal: renders its children full-screen in the PortalHost. */
export function Overlay({ visible, onRequestClose, children }: { visible: boolean; onRequestClose?: () => void; children: React.ReactNode }) {
  const api = useContext(PortalCtx);
  const id = useRef(nextPortalId++).current;
  useEffect(() => {
    api?.set(id, visible ? children : null);
  });
  useEffect(() => () => api?.set(id, null), [api, id]);
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current?.();
      return true;
    });
    return () => sub.remove();
  }, [visible]);
  return null;
}

/** Popup frame: centred normally, moved to the top and kept above the keyboard while typing. */
export function PopupFrame({ children, onBackdropPress, maxHeight = '90%' }: { children: React.ReactNode; onBackdropPress?: () => void; maxHeight?: `${number}%` }) {
  const kb = useKeyboard();
  const insets = useSafeAreaInsets();
  const open = kb.height > 0;
  const topGap = insets.top + 12;
  return (
    <Pressable style={[s.modalBg, open && { justifyContent: 'flex-start', paddingTop: topGap }]} onPress={onBackdropPress}>
      <Pressable
        style={[s.modalBox, { maxHeight: open ? Math.max(180, kb.top - topGap - insets.top - 16) : maxHeight }]}
        onPress={() => {}}
      >
        {children}
      </Pressable>
    </Pressable>
  );
}

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={[s.screen, { padding: 12 }]}>{children}</View>;
  return (
    <KeyboardScroll style={s.screen} contentContainerStyle={{ padding: 12 }} bottomPadding={48}>
      {children}
    </KeyboardScroll>
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
  const { ref, onFocus } = useRevealOnFocus();
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
        ref={ref}
        onFocus={onFocus}
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
  const { ref, onFocus } = useRevealOnFocus();
  return (
    <View style={[{ flex: 1 }, style]}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        ref={ref}
        onFocus={onFocus}
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
      <Overlay visible={open} onRequestClose={() => setOpen(false)}>
        <PopupFrame onBackdropPress={() => setOpen(false)}>
            <Text style={[s.cardTitle, { marginBottom: 8 }]}>{label || 'Select'}</Text>
            {options.length > 8 ? <TextInput style={[s.input, { marginBottom: 8 }]} placeholder="Search…" value={q} onChangeText={setQ} /> : null}
            <FlatList
              data={list}
              keyExtractor={(o) => o.value || '_none'}
              style={{ maxHeight: 420, flexShrink: 1 }}
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
        </PopupFrame>
      </Overlay>
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
