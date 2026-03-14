import { useCallback, useMemo, useRef } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { formatEntryTime } from "../lib/date";
import type { EntryListItem } from "../modules/journal/types";
import { colors } from "../theme";
import { PaperRow } from "./notebook";

const ACTION_WIDTH = 88;
const OPEN_THRESHOLD = ACTION_WIDTH * 0.45;
const SWIPE_PRESS_DELAY_MS = 220;

export type EntrySwipeRowHandle = {
  close: () => void;
};

type EntrySwipeRowProps = {
  entry: EntryListItem;
  onDelete: () => void;
  onOpen: (row: EntrySwipeRowHandle) => void;
  onPress: () => void;
};

export function EntrySwipeRow({
  entry,
  onDelete,
  onOpen,
  onPress,
}: EntrySwipeRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);
  const isOpenRef = useRef(false);
  const suppressPressUntilRef = useRef(0);

  const suppressPress = useCallback(() => {
    suppressPressUntilRef.current = Date.now() + SWIPE_PRESS_DELAY_MS;
  }, []);

  const animateTo = useCallback(
    (toValue: number) => {
      offsetRef.current = toValue;
      isOpenRef.current = toValue !== 0;

      Animated.spring(translateX, {
        toValue,
        useNativeDriver: true,
        bounciness: 0,
        speed: 22,
      }).start();
    },
    [translateX],
  );

  const closeRow = useCallback(() => {
    suppressPress();
    animateTo(0);
  }, [animateTo, suppressPress]);

  const openRow = useCallback(() => {
    suppressPress();
    onOpen({ close: closeRow });
    animateTo(-ACTION_WIDTH);
  }, [animateTo, closeRow, onOpen, suppressPress]);

  const handleDeletePress = useCallback(() => {
    closeRow();
    onDelete();
  }, [closeRow, onDelete]);

  const handleRowPress = useCallback(() => {
    if (isOpenRef.current) {
      closeRow();
      return;
    }

    if (Date.now() < suppressPressUntilRef.current) {
      return;
    }

    onPress();
  }, [closeRow, onPress]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const { dx, dy } = gestureState;
          const horizontalTravel = Math.abs(dx);

          if (horizontalTravel < 8 || horizontalTravel <= Math.abs(dy) * 1.2) {
            return false;
          }

          return dx < 0 || isOpenRef.current;
        },
        onPanResponderGrant: () => {
          translateX.stopAnimation((value) => {
            offsetRef.current = value;
          });
        },
        onPanResponderMove: (_, gestureState) => {
          suppressPress();
          const nextTranslate = Math.min(
            0,
            Math.max(-ACTION_WIDTH, offsetRef.current + gestureState.dx),
          );
          translateX.setValue(nextTranslate);
        },
        onPanResponderRelease: (_, gestureState) => {
          const projectedX = offsetRef.current + gestureState.dx;
          const shouldOpen =
            gestureState.vx < -0.35 || projectedX <= -OPEN_THRESHOLD;

          if (shouldOpen) {
            openRow();
            return;
          }

          closeRow();
        },
        onPanResponderTerminate: () => {
          closeRow();
        },
      }),
    [closeRow, openRow, suppressPress, translateX],
  );

  return (
    <View style={styles.container}>
      <View style={styles.deleteActionWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete entry"
          style={({ pressed }) => [
            styles.deleteAction,
            pressed && styles.deleteActionPressed,
          ]}
          onPress={handleDeletePress}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      </View>

      <Animated.View
        style={[styles.rowWrap, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable accessibilityHint="Swipe left to reveal delete" onPress={handleRowPress}>
          <PaperRow style={styles.row}>
            <Text numberOfLines={2} style={styles.entryPreview}>
              {entry.body || "Empty entry"}
            </Text>
            <Text style={styles.entryMeta}>{formatEntryTime(entry.createdAt)}</Text>
          </PaperRow>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    backgroundColor: colors.background,
  },
  deleteActionWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "flex-end",
  },
  deleteAction: {
    width: ACTION_WIDTH,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#C94D3F",
  },
  deleteActionPressed: {
    backgroundColor: "#B64235",
  },
  deleteText: {
    color: "#FFF8F2",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  rowWrap: {
    backgroundColor: colors.background,
  },
  row: {
    backgroundColor: colors.background,
  },
  entryPreview: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 24,
    paddingRight: 18,
  },
  entryMeta: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 0.8,
    fontFamily: "Courier",
    marginTop: 6,
  },
});
