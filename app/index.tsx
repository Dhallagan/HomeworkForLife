import { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";

import HomeScreen from "../src/modules/home";
import InsightsScreen from "../src/modules/insights/insights-screen";
import EntriesScreen from "../src/modules/journal/entries-screen";
import { colors } from "../src/theme";

type PageName = "insights" | "home" | "entries";

const PAGE_ORDER: PageName[] = ["insights", "home", "entries"];

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
        x: getPageOffset(activePage, width),
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
    const nextIndex = Math.round(offsetX / width);
    setActivePage(PAGE_ORDER[nextIndex] ?? "home");
  }

  function navigateTo(page: PageName) {
    if (!width) {
      return;
    }

    scrollRef.current?.scrollTo({
      x: getPageOffset(page, width),
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
        keyboardShouldPersistTaps="handled"
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
          <HomeScreen
            onNavigateEntries={() => navigateTo("entries")}
            onNavigateInsights={() => navigateTo("insights")}
          />
        </View>
        <View style={[styles.page, { width }]}>
          <EntriesScreen />
        </View>
      </ScrollView>

      <View pointerEvents="none" style={styles.pageIndicator}>
        {PAGE_ORDER.map((page) => (
          <View
            key={page}
            style={[styles.pageDot, activePage === page && styles.pageDotActive]}
          />
        ))}
      </View>
    </View>
  );
}

function getPageOffset(page: PageName, width: number) {
  return PAGE_ORDER.indexOf(page) * width;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  page: {
    flex: 1,
  },
  pageIndicator: {
    position: "absolute",
    top: 18,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  pageDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "#D8D1C5",
  },
  pageDotActive: {
    backgroundColor: colors.accent,
  },
});
