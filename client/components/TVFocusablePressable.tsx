import React, { useState } from "react";
import { Pressable, ViewStyle } from "react-native";

export interface TVFocusablePressableProps {
  onPress: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  baseStyle?: any;
  focusedStyle?: ViewStyle | ViewStyle[];
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
  hitSlop?: number;
  focusable?: boolean;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link";
  accessibilityHint?: string;
  viewRef?: React.RefObject<any>;
  nextFocusUp?: number | null;
  nextFocusDown?: number | null;
  nextFocusLeft?: number | null;
  nextFocusRight?: number | null;
  onLayout?: (e: any) => void;
  onFocusChange?: (focused: boolean) => void;
  testID?: string;
}

/**
 * Shared focusable pressable used across mobile and TV. Tracks D-pad focus
 * state so callers can apply a `focusedStyle`, and forwards all TV focus
 * props (hasTVPreferredFocus / nextFocus*) to the underlying Pressable.
 */
export function TVFocusablePressable({
  onPress,
  onLongPress,
  delayLongPress,
  baseStyle,
  focusedStyle,
  style,
  children,
  hitSlop,
  focusable = true,
  disabled,
  hasTVPreferredFocus,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityHint,
  viewRef,
  nextFocusUp,
  nextFocusDown,
  nextFocusLeft,
  nextFocusRight,
  onLayout,
  onFocusChange,
  testID,
}: TVFocusablePressableProps) {
  const [focused, setFocused] = useState(false);
  const tvProps: any = {};
  if (hasTVPreferredFocus) tvProps.hasTVPreferredFocus = true;
  if (nextFocusUp != null) tvProps.nextFocusUp = nextFocusUp;
  if (nextFocusDown != null) tvProps.nextFocusDown = nextFocusDown;
  if (nextFocusLeft != null) tvProps.nextFocusLeft = nextFocusLeft;
  if (nextFocusRight != null) tvProps.nextFocusRight = nextFocusRight;

  const resolvedStyle = baseStyle
    ? [
        ...(Array.isArray(baseStyle) ? baseStyle : [baseStyle]),
        focused && focusedStyle,
      ]
    : [style, focused && focusedStyle];

  const handleFocus = () => {
    setFocused(true);
    onFocusChange?.(true);
  };
  const handleBlur = () => {
    setFocused(false);
    onFocusChange?.(false);
  };

  return (
    <Pressable
      ref={viewRef}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      onFocus={handleFocus}
      onBlur={handleBlur}
      focusable={focusable}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityHint={accessibilityHint}
      hitSlop={hitSlop}
      onLayout={onLayout}
      testID={testID}
      {...tvProps}
      style={resolvedStyle as ViewStyle[]}
    >
      {children}
    </Pressable>
  );
}
