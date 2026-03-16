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

      <View pointerEvents="none" style={styles.pageIndicator}>
        <View
          style={[
            styles.pageDot,
            activePage === "insights" && styles.pageDotActive,
          ]}
        />
        <View
          style={[
            styles.pageDot,
            activePage === "home" && styles.pageDotActive,
          ]}
        />
      </View>
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
