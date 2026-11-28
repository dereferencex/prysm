import { useCallback, useRef } from "react";
import type { FlashListRef } from "@shopify/flash-list";

interface ViewableItem {
  index: number | null;
}

export function useFlashListFocus<T>() {
  const listRef = useRef<FlashListRef<T>>(null);
  const visibleRange = useRef({ first: Number.POSITIVE_INFINITY, last: -1 });

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewableItem[] }) => {
      let first = Number.POSITIVE_INFINITY;
      let last = -1;
      for (const item of viewableItems) {
        if (item.index == null) continue;
        first = Math.min(first, item.index);
        last = Math.max(last, item.index);
      }
      visibleRange.current = { first, last };
    },
    [],
  );

  const focusOn = useCallback((index: number) => {
    const { first, last } = visibleRange.current;
    if (index >= first && index <= last) return;
    listRef.current?.scrollToIndex({
      index,
      animated: false,
      viewPosition: index < first ? 0 : 1,
    });
  }, []);

  return { listRef, onViewableItemsChanged, focusOn };
}
