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
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  type PanGesture,
} from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  measure,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useScrollOffset,
  useSharedValue,
  withSpring,
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";
import { GripVertical } from "lucide-react-native";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { useInteractionPreferences } from "@/lib/interaction-preferences";
import { radius, usePalette } from "@/lib/theme";

/**
 * Reordering a list by dragging it, the way the web's `SortableList` does.
 *
 * The contract is the web one, translated to touch: holding the grip for a
 * beat picks the row up with a thump, the row lifts and follows the finger
 * 1:1, siblings step aside as the row passes their centres, the list scrolls
 * itself near its edges, and release settles the row into its slot before the
 * caller is handed the complete new order to persist. Letting go without
 * moving — or losing the gesture to a scroll — animates everything back and
 * persists nothing.
 *
 * Every per-frame decision runs as a worklet on the UI thread; JavaScript
 * hears only the moments worth reacting to: pickup, a slot change, the drop.
 *
 * The web handle is also a keyboard path; the equivalent here is a pair of
 * accessibility actions on the grip, so a screen reader can move a row
 * without performing the drag.
 */

// --- pure reorder math ------------------------------------------------------
// Evaluated by sortable-list.test.ts straight out of this file's source, the
// same way i18n.test.ts reads the catalogue: bun cannot parse react-native,
// and the maths should not leave the component just to become testable.
// Everything between these markers must stay dependency-free.

export interface ItemLayout {
  /** Top of the row inside the list container, from `onLayout`. */
  y: number;
  h: number;
}

/** The web's `arrayMove`: the dragged id relocated, everything else intact. */
export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  "worklet";
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/** The vertical gap between rows, recovered from measured geometry. */
export function listGap(layouts: readonly ItemLayout[]): number {
  "worklet";
  const first = layouts[0];
  const second = layouts[1];
  if (!first || !second) return 0;
  return Math.max(0, second.y - (first.y + first.h));
}

/**
 * Where the lifted row would land right now. Centres are compared against the
 * geometry measured at pickup — sibling shifts are presentation, not layout —
 * which is exactly the web sensor's closest-centre rule, so mixed row heights
 * project identically on both platforms.
 */
export function projectIndex(
  layouts: readonly ItemLayout[],
  from: number,
  translation: number,
): number {
  "worklet";
  const lifted = layouts[from];
  if (!lifted) return from;
  const centre = lifted.y + lifted.h / 2 + translation;
  let closest = from;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < layouts.length; index += 1) {
    const item = layouts[index];
    if (!item) continue;
    const distance = Math.abs(item.y + item.h / 2 - centre);
    if (distance < best) {
      best = distance;
      closest = index;
    }
  }
  return closest;
}

/**
 * How far a resting row steps aside while row `from` hovers over `target`.
 * Only the rows between the two move, and each moves by the lifted row's
 * span — its height plus one gap — because that is the hole being filled.
 */
export function siblingOffset(
  index: number,
  from: number,
  target: number,
  span: number,
): number {
  "worklet";
  if (from < 0 || index === from) return 0;
  if (from < target && index > from && index <= target) return -span;
  if (from > target && index >= target && index < from) return span;
  return 0;
}

/**
 * The translation that parks the lifted row exactly where layout will put it
 * once the order commits. Moving down, its bottom meets the target's old
 * bottom; moving up, its top takes the target's old top.
 */
export function settleOffset(
  layouts: readonly ItemLayout[],
  from: number,
  target: number,
): number {
  "worklet";
  const lifted = layouts[from];
  const slot = layouts[target];
  if (!lifted || !slot || from === target) return 0;
  return target > from
    ? slot.y + slot.h - lifted.h - lifted.y
    : slot.y - lifted.y;
}

// --- end pure reorder math --------------------------------------------------

/**
 * Motion. Pickup and slot shifts are critically damped — nothing bounced
 * them, so nothing overshoots. The release inherits the finger's velocity and
 * is allowed a whisker of bounce, because a thrown thing lands. All of it
 * settles well under half a second, and none of it survives reduce-motion.
 */
const PICKUP_DELAY_MS = 200;
/** Drift past this before the hold matures and the touch is a scroll. */
const PICKUP_TOLERANCE = 10;
const LIFT_SCALE = 1.03;
const LIFT_SPRING = { duration: 220, dampingRatio: 1 } as const;
const SIBLING_SPRING = { duration: 300, dampingRatio: 1 } as const;
const DROP_SPRING = { duration: 360, dampingRatio: 0.82 } as const;
/** Fastest autoscroll, in pixels per frame at the very edge of the viewport. */
const AUTOSCROLL_MAX_STEP = 14;

const PHASE_IDLE = 0;
const PHASE_DRAGGING = 1;
const PHASE_SETTLING = 2;

export interface SortableScroll {
  ref: AnimatedRef<Animated.ScrollView>;
  offset: SharedValue<number>;
  contentHeight: SharedValue<number>;
  onContentSizeChange: (width: number, height: number) => void;
}

/**
 * The scroll view a sortable list lives in, made visible to it. Spread `ref`
 * and `onContentSizeChange` onto an `Animated.ScrollView` and hand the whole
 * object to `SortableList`; dragging near an edge then scrolls the list. The
 * screen should also pause scrolling while a drag runs — wire
 * `scrollEnabled={!dragging}` from `onDragStateChange`.
 */
export function useSortableScroll(): SortableScroll {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const offset = useScrollOffset(ref);
  const contentHeight = useSharedValue(0);
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeight.value = height;
    },
    [contentHeight],
  );
  return useMemo(
    () => ({ ref, offset, contentHeight, onContentSizeChange }),
    [ref, offset, contentHeight, onContentSizeChange],
  );
}

interface ListValue {
  layouts: SharedValue<ItemLayout[]>;
  activeIndex: SharedValue<number>;
  targetIndex: SharedValue<number>;
  translation: SharedValue<number>;
  dragBase: SharedValue<number>;
  gestureY: SharedValue<number>;
  fingerY: SharedValue<number>;
  scrollStart: SharedValue<number>;
  lift: SharedValue<number>;
  phase: SharedValue<number>;
  refreshDrag: () => void;
  pickup: () => void;
  commit: (from: number, to: number) => void;
  moveBy: (index: number, direction: -1 | 1) => void;
  register: (index: number, layout: ItemLayout) => void;
  scroll?: SortableScroll;
  disabled: boolean;
  reduceMotion: boolean;
}

const ListContext = createContext<ListValue | null>(null);

interface ItemValue {
  gesture: PanGesture;
  disabled: boolean;
  moveBy: (direction: -1 | 1) => void;
}

const ItemContext = createContext<ItemValue | null>(null);

export function SortableList({
  ids,
  renderItem,
  onReorder,
  disabled = false,
  gap = 0,
  scroll,
  onDragStateChange,
  style,
}: {
  /** Every row id, in visual order. */
  ids: string[];
  renderItem: (id: string, index: number) => ReactNode;
  /**
   * The complete new order, delivered once the dropped row has settled.
   * Callers must reflect it in `ids` synchronously — an optimistic state set
   * beside the mutation — so the committed layout matches the settled frame.
   */
  onReorder: (ids: string[]) => void;
  disabled?: boolean;
  /** Vertical gap between rows; the list owns its container so it owns this. */
  gap?: number;
  scroll?: SortableScroll;
  /** Fires at pickup and at rest — the hook for `scrollEnabled`. */
  onDragStateChange?: (dragging: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduceMotion } = useInteractionPreferences();

  const layouts = useSharedValue<ItemLayout[]>([]);
  const activeIndex = useSharedValue(-1);
  const targetIndex = useSharedValue(-1);
  const translation = useSharedValue(0);
  const dragBase = useSharedValue(0);
  const gestureY = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const scrollStart = useSharedValue(0);
  const lift = useSharedValue(0);
  const phase = useSharedValue(PHASE_IDLE);

  const [dragging, setDragging] = useState(false);

  // The JS-side callbacks flow through refs so the gesture worklets can hold
  // one stable function forever and still see the current `ids` and props.
  const commitRef = useRef<(from: number, to: number) => void>(() => {});
  commitRef.current = (from: number, to: number) => {
    // A row grabbed again mid-settle keeps its drag; this commit is stale.
    if (phase.value !== PHASE_SETTLING) return;
    const changed =
      from !== to &&
      from >= 0 &&
      to >= 0 &&
      from < ids.length &&
      to < ids.length;
    // Reset and reorder in one synchronous pass: Fabric mounts the new order
    // in this same task, so zeroed transforms and the new layout reach the
    // screen on the same frame and nothing flashes.
    activeIndex.value = -1;
    targetIndex.value = -1;
    translation.value = 0;
    dragBase.value = 0;
    lift.value = 0;
    phase.value = PHASE_IDLE;
    setDragging(false);
    onDragStateChange?.(false);
    if (changed) {
      haptic("light");
      onReorder(moveItem(ids, from, to));
    }
  };
  const commit = useCallback((from: number, to: number) => {
    commitRef.current(from, to);
  }, []);

  const pickupRef = useRef<() => void>(() => {});
  pickupRef.current = () => {
    haptic("medium");
    setDragging(true);
    onDragStateChange?.(true);
  };
  const pickup = useCallback(() => {
    pickupRef.current();
  }, []);

  const tick = useCallback(() => {
    haptic("selection");
  }, []);

  // The accessibility path: the same reorder, minus the drag.
  const moveByRef = useRef<(index: number, direction: -1 | 1) => void>(
    () => {},
  );
  moveByRef.current = (index: number, direction: -1 | 1) => {
    const to = index + direction;
    if (disabled || to < 0 || to >= ids.length) return;
    haptic("light");
    onReorder(moveItem(ids, index, to));
  };
  const moveBy = useCallback((index: number, direction: -1 | 1) => {
    moveByRef.current(index, direction);
  }, []);

  const register = useCallback(
    (index: number, layout: ItemLayout) => {
      const next = layouts.value.slice();
      next[index] = layout;
      layouts.value = next;
    },
    [layouts],
  );

  useEffect(() => {
    if (layouts.value.length > ids.length) {
      layouts.value = layouts.value.slice(0, ids.length);
    }
  }, [ids.length, layouts]);

  /** Recompute the lifted row's position and landing slot. UI thread only. */
  const refreshDrag = useCallback(() => {
    "worklet";
    const from = activeIndex.value;
    if (from < 0) return;
    const scrolled = scroll ? scroll.offset.value - scrollStart.value : 0;
    translation.value = dragBase.value + gestureY.value + scrolled;
    const next = projectIndex(layouts.value, from, translation.value);
    if (next !== targetIndex.value) {
      targetIndex.value = next;
      runOnJS(tick)();
    }
  }, [
    activeIndex,
    dragBase,
    gestureY,
    layouts,
    scroll,
    scrollStart,
    targetIndex,
    tick,
    translation,
  ]);

  // Autoscroll: alive only while a drag runs, and entirely on the UI thread.
  // Proximity to an edge sets the speed; the finger stays glued because the
  // scroll delta feeds straight back into `refreshDrag`.
  const autoscroll = useFrameCallback(() => {
    if (!scroll || phase.value !== PHASE_DRAGGING) return;
    const frame = measure(scroll.ref);
    if (frame === null) return;
    const edge = Math.min(120, Math.max(48, frame.height * 0.15));
    const fromTop = fingerY.value - frame.pageY;
    const fromBottom = frame.pageY + frame.height - fingerY.value;
    let step = 0;
    if (fromTop < edge) {
      step = -AUTOSCROLL_MAX_STEP * (1 - Math.max(0, fromTop) / edge);
    } else if (fromBottom < edge) {
      step = AUTOSCROLL_MAX_STEP * (1 - Math.max(0, fromBottom) / edge);
    }
    if (step === 0) return;
    const limit = Math.max(0, scroll.contentHeight.value - frame.height);
    const floor = Math.min(0, scrollStart.value);
    const next = Math.min(limit, Math.max(floor, scroll.offset.value + step));
    if (Math.abs(next - scroll.offset.value) < 0.5) return;
    scrollTo(scroll.ref, 0, next, false);
    refreshDrag();
  }, false);
  const setAutoscrollActive = autoscroll.setActive;
  useEffect(() => {
    setAutoscrollActive(dragging && scroll !== undefined);
  }, [dragging, scroll, setAutoscrollActive]);

  const value = useMemo<ListValue>(
    () => ({
      layouts,
      activeIndex,
      targetIndex,
      translation,
      dragBase,
      gestureY,
      fingerY,
      scrollStart,
      lift,
      phase,
      refreshDrag,
      pickup,
      commit,
      moveBy,
      register,
      scroll,
      disabled,
      reduceMotion,
    }),
    [
      layouts,
      activeIndex,
      targetIndex,
      translation,
      dragBase,
      gestureY,
      fingerY,
      scrollStart,
      lift,
      phase,
      refreshDrag,
      pickup,
      commit,
      moveBy,
      register,
      scroll,
      disabled,
      reduceMotion,
    ],
  );

  return (
    <ListContext.Provider value={value}>
      <View style={[{ gap }, style]}>
        {ids.map((id, index) => (
          <SortableItem key={id} index={index}>
            {renderItem(id, index)}
          </SortableItem>
        ))}
      </View>
    </ListContext.Provider>
  );
}

function SortableItem({
  index,
  children,
}: {
  index: number;
  children: ReactNode;
}) {
  const list = useContext(ListContext);
  if (!list) throw new Error("SortableItem must live inside a SortableList");
  return (
    <SortableItemInner list={list} index={index}>
      {children}
    </SortableItemInner>
  );
}

function SortableItemInner({
  list,
  index,
  children,
}: {
  list: ListValue;
  index: number;
  children: ReactNode;
}) {
  const palette = usePalette();
  const {
    layouts,
    activeIndex,
    targetIndex,
    translation,
    dragBase,
    gestureY,
    fingerY,
    scrollStart,
    lift,
    phase,
    refreshDrag,
    pickup,
    commit,
    moveBy,
    register,
    scroll,
    disabled,
    reduceMotion,
  } = list;

  // Whether this row's gesture is the one on stage. Set on activation, so a
  // touch that never matured — or arrived while another row was mid-flight —
  // is ignored by every later callback.
  const owns = useSharedValue(false);

  const gesture = useMemo(() => {
    return (
      Gesture.Pan()
        .enabled(!disabled)
        .maxPointers(1)
        // A short deliberate hold separates reordering from scrolling — the
        // web touch sensor's delay — and drifting during the hold hands the
        // touch back to the scroll view, which is its tolerance.
        .activateAfterLongPress(PICKUP_DELAY_MS)
        .failOffsetX([-PICKUP_TOLERANCE, PICKUP_TOLERANCE])
        .failOffsetY([-PICKUP_TOLERANCE, PICKUP_TOLERANCE])
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          if (phase.value === PHASE_SETTLING && activeIndex.value === index) {
            // Grabbed mid-settle: keep the motion, absorb what has played so
            // far, and carry on from exactly here.
            cancelAnimation(translation);
            dragBase.value = translation.value;
          } else if (phase.value !== PHASE_IDLE) {
            return;
          } else {
            dragBase.value = 0;
            translation.value = 0;
            targetIndex.value = index;
          }
          owns.value = true;
          phase.value = PHASE_DRAGGING;
          activeIndex.value = index;
          gestureY.value = 0;
          scrollStart.value = scroll ? scroll.offset.value : 0;
          lift.value = reduceMotion ? 1 : withSpring(1, LIFT_SPRING);
          runOnJS(pickup)();
        })
        .onUpdate((event) => {
          if (!owns.value) return;
          gestureY.value = event.translationY;
          fingerY.value = event.absoluteY;
          refreshDrag();
        })
        .onFinalize((event, success) => {
          if (!owns.value) return;
          owns.value = false;
          const from = activeIndex.value;
          // A cancelled gesture — a scroll won, the app lost focus — goes home.
          const to = success ? targetIndex.value : from;
          targetIndex.value = to;
          phase.value = PHASE_SETTLING;
          const settle = settleOffset(layouts.value, from, to);
          lift.value = reduceMotion ? 0 : withSpring(0, SIBLING_SPRING);
          if (reduceMotion) {
            translation.value = settle;
            runOnJS(commit)(from, to);
          } else {
            translation.value = withSpring(
              settle,
              { ...DROP_SPRING, velocity: event.velocityY },
              (finished) => {
                if (finished) runOnJS(commit)(from, to);
              },
            );
          }
        })
    );
  }, [
    activeIndex,
    commit,
    disabled,
    dragBase,
    fingerY,
    gestureY,
    index,
    layouts,
    lift,
    owns,
    phase,
    pickup,
    reduceMotion,
    refreshDrag,
    scroll,
    scrollStart,
    targetIndex,
    translation,
  ]);

  const wrapperStyle = useAnimatedStyle(() => {
    if (activeIndex.value === index) {
      return {
        zIndex: 10,
        opacity: 1 - 0.03 * lift.value,
        transform: [
          { translateY: translation.value },
          { scale: 1 + (LIFT_SCALE - 1) * lift.value },
        ],
      };
    }
    const from = activeIndex.value;
    let shift = 0;
    if (from >= 0) {
      const lifted = layouts.value[from];
      if (lifted) {
        shift = siblingOffset(
          index,
          from,
          targetIndex.value,
          lifted.h + listGap(layouts.value),
        );
      }
    }
    return {
      zIndex: 0,
      opacity: 1,
      transform: [
        // Idle rows report a raw zero so the post-drop reset and the new
        // layout land together; live rows spring, and retarget mid-flight.
        {
          translateY:
            reduceMotion || from < 0
              ? shift
              : withSpring(shift, SIBLING_SPRING),
        },
        { scale: 1 },
      ],
    };
  });

  // The lift wears the web's dragged-row clothes — surface, border, radius,
  // shadow — on a plate behind the row, faded in by the same value that
  // scales it, so the whole costume arrives as one motion.
  const plateStyle = useAnimatedStyle(() => ({
    opacity: lift.value,
  }));

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      register(index, {
        y: event.nativeEvent.layout.y,
        h: event.nativeEvent.layout.height,
      });
    },
    [index, register],
  );

  const item = useMemo<ItemValue>(
    () => ({
      gesture,
      disabled,
      moveBy: (direction: -1 | 1) => moveBy(index, direction),
    }),
    [gesture, disabled, moveBy, index],
  );

  return (
    <Animated.View onLayout={onLayout} style={wrapperStyle}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: palette.surface,
            borderRadius: radius.xl,
            borderCurve: "continuous",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            // The web's shadow-lg, in the house boxShadow notation.
            boxShadow: "0 10px 15px rgba(0, 0, 0, 0.14)",
          },
          plateStyle,
        ]}
      />
      <ItemContext.Provider value={item}>{children}</ItemContext.Provider>
    </Animated.View>
  );
}

/** The grip. Place it anywhere inside a row; it is the only drag surface. */
export function SortableHandle({ style }: { style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  const item = useContext(ItemContext);
  if (!item) return null;

  return (
    <GestureDetector gesture={item.gesture}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={t("Reorder")}
        accessibilityState={{ disabled: item.disabled }}
        accessibilityActions={[
          { name: "moveUp", label: t("Move up") },
          { name: "moveDown", label: t("Move down") },
        ]}
        onAccessibilityAction={(event: AccessibilityActionEvent) => {
          if (event.nativeEvent.actionName === "moveUp") item.moveBy(-1);
          if (event.nativeEvent.actionName === "moveDown") item.moveBy(1);
        }}
        hitSlop={6}
        style={[
          {
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            borderCurve: "continuous",
            opacity: item.disabled ? 0.4 : 1,
          },
          style,
        ]}
      >
        <GripVertical size={20} color={palette.textFaint} strokeWidth={2} />
      </View>
    </GestureDetector>
  );
}
