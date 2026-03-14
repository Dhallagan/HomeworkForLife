import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";

import HomeScreen from "../src/modules/home/home-screen";
import InsightsScreen from "../src/modules/insights/insights-screen";
import { colors } from "../src/theme";

type PageName = "insights" | "home";

export default function RootPagerScreen() {
  const scrollRef = useRef<ScrollView | null>(null);
  const { width } = useWindowDimensions();
  const [activePage, setActivePage] = useState<PageName>("home");

  useEffect(() => {
    if (!width) {
      return;
    }

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        x: activePage === "home" ? width : 0,
        animated: false,
      });
    });
  }, [activePage, width]);

  function handleMomentumScrollEnd(
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) {
    if (!width) {
      return;
    }

    const offsetX = event.nativeEvent.contentOffset.x;
    setActivePage(offsetX < width / 2 ? "insights" : "home");
  }

  function navigateTo(page: PageName) {
    if (!width) {
      return;
    }

    scrollRef.current?.scrollTo({
      x: page === "home" ? width : 0,
      animated: true,
    });
    setActivePage(page);
  }

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        directionalLockEnabled
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        bounces={false}
        contentOffset={{ x: width, y: 0 }}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleMomentumScrollEnd}
      >
        <View style={[styles.page, { width }]}>
          <InsightsScreen onNavigateHome={() => navigateTo("home")} />
        </View>
        <View style={[styles.page, { width }]}>
          <HomeScreen />
        </View>
      </ScrollView>

      {activePage === "home" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Opens the Insights screen"
          style={styles.peekRail}
          onPress={() => navigateTo("insights")}
        >
          <Text style={styles.peekLabel}>Insights</Text>
          <Text style={styles.peekHint}>Swipe right</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  page: {
    flex: 1,
  },
  peekRail: {
    position: "absolute",
    left: 0,
    top: 92,
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: 10,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  peekLabel: {
    color: colors.text,
    fontSize: 13,
    letterSpacing: 0.8,
    fontFamily: "Courier",
    textTransform: "uppercase",
  },
  peekHint: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 3,
  },
});
