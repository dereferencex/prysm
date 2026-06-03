import React, { useState } from "react";
import { Pressable, Platform, ViewStyle } from "react-native";

const isTV = Platform.isTV;

export interface TVFocusablePressableProps {
  onPress: () => void;
  baseStyle?: any;
  focusedStyle?: ViewStyle;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
  hitSlop?: number;
  focusable?: boolean;
  hasTVPreferredFocus?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link";
  viewRef?: React.RefObject<any>;
  nextFocusUp?: number | null;
  nextFocusDown?: number | null;
  nextFocusLeft?: number | null;
  nextFocusRight?: number | null;
}

export function TVFocusablePressable({
  onPress,
  baseStyle,
  focusedStyle,
  style,
  children,
  hitSlop,
  focusable = true,
  hasTVPreferredFocus,
  accessibilityLabel,
  accessibilityRole = "button",
  viewRef,
  nextFocusUp,
  nextFocusDown,
  nextFocusLeft,
  nextFocusRight,
}: TVFocusablePressableProps) {
  const [focused, setFocused] = useState(false);
  const tvProps: any = {};
  if (hasTVPreferredFocus) tvProps.hasTVPreferredFocus = true;
  if (nextFocusUp != null) tvProps.nextFocusUp = nextFocusUp;
  if (nextFocusDown != null) tvProps.nextFocusDown = nextFocusDown;
  if (nextFocusLeft != null) tvProps.nextFocusLeft = nextFocusLeft;
  if (nextFocusRight != null) tvProps.nextFocusRight = nextFocusRight;

  const resolvedStyle = baseStyle
    ? [...(Array.isArray(baseStyle) ? baseStyle : [baseStyle]), focused && focusedStyle]
    : [style, focused && focusedStyle];

  return (
    <Pressable
      ref={viewRef}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      focusable={focusable}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      hitSlop={hitSlop}
      {...tvProps}
      style={resolvedStyle as ViewStyle[]}
    >
      {children}
    </Pressable>
  );
}
