import { useCallback, useRef } from "react";
import { ScrollView, type LayoutChangeEvent } from "react-native";

type Axis = "vertical" | "horizontal";

interface ItemBounds {
  start: number;
  size: number;
}

interface UseFocusScrollOptions {
  axis?: Axis;
  padding?: number;
}

export function useFocusScroll<TKey extends string | number = string>({
  axis = "vertical",
  padding = 24,
}: UseFocusScrollOptions = {}) {
  const scrollRef = useRef<ScrollView | null>(null);
  const boundsRef = useRef<Map<TKey, ItemBounds>>(new Map());
  const viewportRef = useRef(0);
  const offsetRef = useRef(0);

  const resolveMainAxis = useCallback(
    (e: LayoutChangeEvent) => {
      if (axis === "vertical") {
        return {
          start: e.nativeEvent.layout.y,
          size: e.nativeEvent.layout.height,
        };
      }
      return {
        start: e.nativeEvent.layout.x,
        size: e.nativeEvent.layout.width,
      };
    },
    [axis],
  );

  const onScrollViewLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      viewportRef.current = axis === "vertical" ? height : width;
    },
    [axis],
  );

  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number; y: number } } }) => {
      const { x, y } = e.nativeEvent.contentOffset;
      offsetRef.current = axis === "vertical" ? y : x;
    },
    [axis],
  );

  const registerItem = useCallback(
    (key: TKey, e: LayoutChangeEvent) => {
      const { start, size } = resolveMainAxis(e);
      boundsRef.current.set(key, { start, size });
    },
    [resolveMainAxis],
  );

  const focusOn = useCallback(
    (key: TKey | null | undefined) => {
      if (key == null) return;
      const item = boundsRef.current.get(key);
      const scroller = scrollRef.current;
      const viewport = viewportRef.current;
      if (!item || !scroller || viewport <= 0) return;
      const current = offsetRef.current;
      const minimumVisible = current + padding;
      const maximumVisible = current + viewport - padding;
      let target: number | null = null;
      if (item.start < minimumVisible) {
        target = item.start - padding;
      } else if (item.start + item.size > maximumVisible) {
        target = item.start + item.size - viewport + padding;
      }
      if (target != null) {
        const args: { x?: number; y?: number; animated?: boolean } = {
          animated: true,
        };
        if (axis === "vertical") args.y = Math.max(0, target);
        else args.x = Math.max(0, target);
        scroller.scrollTo(args);
      }
    },
    [axis, padding],
  );

  return {
    scrollRef,
    onScrollViewLayout,
    onScroll,
    registerItem,
    focusOn,
  };
}
