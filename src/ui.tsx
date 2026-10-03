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
import { evalExpr, isExpression, num, parseNum } from './utils';

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
            if (y < top + 8 || y + h > bottom - 16 - CALC_BAR_H) {
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
        contentContainerStyle={[contentContainerStyle, { paddingBottom: bottomPadding + kb.height + (kb.height ? CALC_BAR_H : 0) }]}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={(e) => (offset.current = e.nativeEvent.contentOffset.y)}
      >
        {children}
      </ScrollView>
    </RevealCtx.Provider>
  );
}

// ---------------- Calculator row ----------------
// Number boxes accept sums (2000+1500-200). The phone's number keyboard has no + − × ÷,
// so a row with them sits just above the keyboard while a number box is being typed in.

const CALC_BAR_H = 46;
type CalcTarget = { press: (key: string) => void; focused: () => boolean };
type CalcApi = { focus: (t: CalcTarget) => void; blur: (t: CalcTarget) => void };
const CalcCtx = createContext<CalcApi | null>(null);

export function CalcHost({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<CalcTarget | null>(null);
  const kb = useKeyboard();
  const api = useMemo<CalcApi>(
    () => ({
      focus: (t) => setTarget(t),
      // Delay so a tap on the row still reaches the box that was being edited.
      blur: (t) => setTimeout(() => !t.focused() && setTarget((cur) => (cur === t ? null : cur)), 250),
    }),
    [],
  );
  const showing = target && (kb.height > 0 || Platform.OS === 'web');
  return (
    <CalcCtx.Provider value={api}>
      {children}
      {showing ? (
        <View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, { justifyContent: kb.height ? 'flex-start' : 'flex-end' }]}
        >
          <View style={[s.calcBar, kb.height ? { position: 'absolute', left: 0, right: 0, top: kb.top - CALC_BAR_H } : null]}>
            {['+', '−', '×', '÷', '(', ')', '⌫', '='].map((k) => (
              <Pressable key={k} onPress={() => target?.press(k)} style={({ pressed }) => [s.calcKey, k === '=' && s.calcKeyEq, pressed && { opacity: 0.6 }]}>
                <Text style={[s.calcKeyText, k === '=' && { color: '#fff' }]}>{k}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </CalcCtx.Provider>
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
  const calc = useContext(CalcCtx);
  const fmt = (v: number | undefined) => (v === undefined || (v === 0 && !allowEmpty) ? '' : String(v));
  const [text, setText] = useState(fmt(value));
  // After a tap on the calculator row puts the cursor back, don't select (and overwrite) the sum.
  const [keepCaret, setKeepCaret] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;
  const valueOf = (t: string) => (t.trim() === '' ? undefined : isExpression(t) ? evalExpr(t) : parseNum(t));
  useEffect(() => {
    const cur = valueOf(text);
    if (cur !== value && !(cur === undefined && value === 0)) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const apply = (t: string) => {
    setText(t);
    textRef.current = t;
    if (t.trim() === '') return onChange(allowEmpty ? undefined : 0);
    const v = valueOf(t);
    if (v !== undefined) onChange(v);
  };
  /** Replaces a finished sum with its result. */
  const settle = () => {
    const t = textRef.current;
    if (!isExpression(t)) return;
    const v = evalExpr(t);
    if (v === undefined) return;
    setText(fmt(v));
    textRef.current = fmt(v);
    onChange(v);
  };
  const target = useRef<CalcTarget>({ press: () => {}, focused: () => false }).current;
  target.focused = () => !!ref.current?.isFocused();
  target.press = (k) => {
    const t = textRef.current;
    if (k === '=') settle();
    else if (k === '⌫') apply(t.slice(0, -1));
    else apply(t + (k === '−' ? '-' : k === '×' ? '*' : k === '÷' ? '/' : k));
    // Keep typing in the same box (a tap on the row can take focus away on some phones).
    if (k !== '=' && !ref.current?.isFocused()) {
      setKeepCaret(true);
      setTimeout(() => ref.current?.focus(), 0);
    }
  };
  const preview = isExpression(text) ? evalExpr(text) : undefined;
  return (
    <View style={[{ flex: 1 }, style]}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        ref={ref}
        onFocus={() => {
          onFocus();
          if (editable) calc?.focus(target);
        }}
        onBlur={() => {
          if (!keepCaret) settle();
          calc?.blur(target);
          setTimeout(() => !ref.current?.isFocused() && setKeepCaret(false), 300);
        }}
        onSubmitEditing={settle}
        style={[s.input, !editable && s.inputDisabled]}
        value={text}
        editable={editable}
        keyboardType="decimal-pad"
        placeholder={placeholder ?? '0'}
        placeholderTextColor="#9AA8B5"
        selectTextOnFocus={!keepCaret}
        onChangeText={(t) => apply(t.replace(/[^0-9.,+\-*/x×÷()]/g, ''))}
      />
      {preview !== undefined ? <Text style={{ color: C.primary, fontSize: 12, marginTop: 2 }}>= {num(preview)}</Text> : null}
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

/**
 * Keeps an icon and its word together. Some Android phones measure emoji a little too
 * narrow, so "📊 Summary" wrapped onto a hidden second line and only the icon showed.
 */
function keepIconWithWord(t: string): string {
  return t.replace(/^([^\p{L}\p{N}(]+?) /u, '$1\u00A0');
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
      <Text style={[s.btnText, { color: fg }, small && { fontSize: 13 }]} textBreakStrategy="simple">
        {keepIconWithWord(title)}
      </Text>
    </Pressable>
  );
}

export function HStack({ children, style, gap = 8 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', gap, alignItems: 'flex-end' }, style]}>{children}</View>;
}

export function Chip({ title, active, onPress }: { title: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { backgroundColor: C.primary }]}>
      <Text style={[s.chipText, active && { color: '#fff' }]} numberOfLines={1} textBreakStrategy="simple">
        {keepIconWithWord(title)}
      </Text>
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
  calcBar: { flexDirection: 'row', backgroundColor: '#E3E8EE', height: CALC_BAR_H, paddingHorizontal: 4, paddingVertical: 4, gap: 4, borderTopWidth: 1, borderColor: '#C9D2DC' },
  calcKey: { flex: 1, backgroundColor: '#fff', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  calcKeyEq: { backgroundColor: '#0B5FA5' },
  calcKeyText: { fontSize: 18, fontWeight: '700', color: '#16202B' },
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
