import {
  AppState,
  Alert,
  PixelRatio,
  Pressable,
  Share,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAudioPlayer } from "expo-audio";
import * as Sharing from "expo-sharing";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { heatmapDays, type Year, type YearReview } from "@avermate/core";
import { formatDate, formatNumber } from "@/components/format";
import { haptic } from "@/lib/haptics";
import { locale, t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";
import { useInteractionPreferences } from "@/lib/interaction-preferences";
import { space, type } from "@/lib/theme";
import { awardBlurb, awardEmoji, awardTitle } from "./review-copy";
import { reviewStorySlides, type ReviewSlideKey } from "./review-story-model";

/**
 * Saving to the photo library, only if the binary can.
 *
 * `expo-media-library` was imported at module scope, and its native module was
 * not in the build — so requiring this file threw, which took down the whole
 * `review` route: expo-router reported it as "missing the required default
 * export" because the module never finished evaluating. One optional feature
 * cost the entire screen.
 *
 * The plugin is declared now, but a native module that is absent — an older
 * build, Expo Go, a platform that does not have it — must degrade to sharing
 * rather than crash. So it is required on demand and its absence is a `null`.
 */
type MediaLibraryModule = typeof import("expo-media-library");

function loadMediaLibrary(): MediaLibraryModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-media-library") as MediaLibraryModule;
  } catch {
    return null;
  }
}

/**
 * Same story for the screenshot module. A module-scope import of a native
 * module that is not in the running binary does not fail at the call site — it
 * fails while the route is being evaluated, and expo-router then reports the
 * whole screen as missing its default export.
 */
type ViewShotModule = typeof import("react-native-view-shot");

function loadViewShot(): ViewShotModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-view-shot") as ViewShotModule;
  } catch {
    return null;
  }
}

const recapMusic = require("../../assets/recap-music.mp3");

const slideBackground: Record<ReviewSlideKey, string> = {
  intro: "#120E2D",
  headline: "#10213E",
  heatmap: "#112B24",
  streak: "#35170E",
  prime: "#142A48",
  subjects: "#241644",
  progression: "#0D302B",
  award: "#3A2607",
  percentile: "#25133D",
  finale: "#111827",
};

function monthName(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year as number, (month as number) - 1, 1).toLocaleDateString(
    locale() === "fr" ? "fr-FR" : "en-GB",
    { month: "long", year: "numeric" },
  );
}

function mark(value: number | null, scale: number, decimals: number): string {
  return value === null
    ? "—"
    : `${formatNumber(value * scale, decimals)} / ${scale}`;
}

function GlassStat({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 86,
        borderRadius: 18,
        borderCurve: "continuous",
        backgroundColor: "rgba(255,255,255,.09)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,.13)",
        padding: space.md,
        gap: space.xs,
      }}
    >
      <Text
        selectable
        style={[type.title, { color: "white", fontVariant: ["tabular-nums"] }]}
      >
        {value}
      </Text>
      <Text
        selectable
        style={[type.footnote, { color: "rgba(255,255,255,.58)" }]}
      >
        {label}
      </Text>
    </View>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <Text
      selectable
      style={[
        type.label,
        { color: "rgba(255,255,255,.56)", textAlign: "center" },
      ]}
    >
      {children}
    </Text>
  );
}

export function YearReviewStory({
  onClose,
  review,
  reviewKey,
  scale,
  decimals,
  userName,
  year,
}: {
  decimals: number;
  onClose: () => void;
  review: YearReview;
  reviewKey: string;
  scale: number;
  userName: string;
  year: Year;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useInteractionPreferences();
  const slides = useMemo(() => reviewStorySlides(review), [review]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const [exporting, setExporting] = useState<"save" | "share" | null>(null);
  const shareCardRef = useRef<View>(null);
  const markedRef = useRef(false);
  const player = useAudioPlayer(recapMusic, { downloadFirst: true });
  const queryClient = useQueryClient();
  const markSeen = useMutation(orpc.review.markSeen.mutationOptions());
  const current = slides[index] ?? slides[0]!;
  const isLast = index === slides.length - 1;

  const next = useCallback(() => {
    setIndex((value) => Math.min(slides.length - 1, value + 1));
    progressRef.current = 0;
    setProgress(0);
    haptic("selection");
  }, [slides.length]);
  const previous = useCallback(() => {
    setIndex((value) => Math.max(0, value - 1));
    progressRef.current = 0;
    setProgress(0);
    haptic("selection");
  }, []);

  useEffect(() => {
    if (markedRef.current) return;
    markedRef.current = true;
    markSeen.mutate(
      { yearId: year.id, reviewKey },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({
            queryKey: orpc.review.status.queryKey({
              input: { yearId: year.id, reviewKey },
            }),
          }),
      },
    );
  }, [markSeen, queryClient, reviewKey, year.id]);

  useEffect(() => {
    player.loop = true;
    player.volume = 0.22;
    player.play();
    return () => player.pause();
  }, [player]);

  useEffect(() => {
    if (muted || paused) player.pause();
    else player.play();
  }, [muted, paused, player]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") setPaused(true);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (paused || reduceMotion || isLast) return;
    const duration = current.duration;
    const startedAt = Date.now() - progressRef.current * duration;
    const timer = setInterval(() => {
      const value = Math.min(1, (Date.now() - startedAt) / duration);
      progressRef.current = value;
      setProgress(value);
      if (value >= 1) {
        clearInterval(timer);
        next();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [current.duration, isLast, next, paused, reduceMotion]);

  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-18, 18])
        .failOffsetY([-28, 28])
        .onEnd((event) => {
          if (event.translationX < -48 || event.velocityX < -650) next();
          else if (event.translationX > 48 || event.velocityX > 650) previous();
        })
        .runOnJS(true),
    [next, previous],
  );

  const heatmap = useMemo(() => {
    const until = new Date(
      Math.min(Date.now(), new Date(year.endsAt).getTime()),
    );
    return heatmapDays(review.heatmap, new Date(year.startsAt), until);
  }, [review.heatmap, year.endsAt, year.startsAt]);
  const weeksVisible = Math.max(
    12,
    Math.min(22, Math.floor((width - 52) / 13)),
  );
  const heatmapVisible = heatmap.slice(-weeksVisible * 7);
  const heatmapWeeks = Array.from(
    { length: Math.ceil(heatmapVisible.length / 7) },
    (_, week) => heatmapVisible.slice(week * 7, week * 7 + 7),
  );

  const summary = t(
    "{name}'s {year} Avermate recap: {average}, {count} grades, {streak}-day streak.",
    {
      average: mark(review.average, scale, decimals),
      count: String(review.gradeCount),
      name: userName,
      streak: String(review.longestStreak),
      year: year.name,
    },
  );

  const exportRecap = useCallback(
    async (action: "save" | "share") => {
      if (exporting) return;
      setExporting(action);
      try {
        const viewShot = loadViewShot();
        if (
          process.env.EXPO_OS === "web" ||
          !shareCardRef.current ||
          !viewShot
        ) {
          await Share.share({
            message: summary,
            title: t("My Avermate recap"),
          });
          return;
        }
        const pixelRatio = PixelRatio.get();
        const uri = await viewShot.captureRef(shareCardRef, {
          format: "png",
          height: 1080 / pixelRatio,
          quality: 1,
          result: "tmpfile",
          width: 1080 / pixelRatio,
        });
        if (action === "share") {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, {
              dialogTitle: t("Share my Avermate recap"),
              mimeType: "image/png",
              UTI: "public.png",
            });
          } else {
            await Share.share({ message: summary });
          }
          return;
        }
        const mediaLibrary = loadMediaLibrary();
        if (!mediaLibrary) {
          // No gallery access in this build: offer the thing that does work
          // rather than an error about a module nobody asked about.
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, {
              dialogTitle: t("Share my Avermate recap"),
              mimeType: "image/png",
              UTI: "public.png",
            });
          } else {
            await Share.share({ message: summary });
          }
          return;
        }
        const permission = await mediaLibrary.requestPermissionsAsync(true, [
          "photo",
        ]);
        if (!permission.granted) {
          Alert.alert(
            t("Photo access needed"),
            t("Allow photo access to save your recap image."),
          );
          return;
        }
        await mediaLibrary.Asset.create(uri);
        haptic("success");
        Alert.alert(
          t("Saved"),
          t("Your recap image is in your photo library."),
        );
      } catch {
        haptic("error");
        Alert.alert(t("Could not export recap"), t("Please try again."));
      } finally {
        setExporting(null);
      }
    },
    [exporting, summary],
  );

  const weekdays = [
    t("Sunday"),
    t("Monday"),
    t("Tuesday"),
    t("Wednesday"),
    t("Thursday"),
    t("Friday"),
    t("Saturday"),
  ];

  const slide = (() => {
    switch (current.key) {
      case "intro":
        return (
          <View style={{ alignItems: "center", gap: space.lg }}>
            <Text style={{ fontSize: 44 }}>✨</Text>
            <Eyebrow>{t("Your year in Avermate")}</Eyebrow>
            <Text
              selectable
              style={[
                type.display,
                {
                  color: "white",
                  textAlign: "center",
                  fontSize: width < 360 ? 30 : 36,
                },
              ]}
            >
              {year.name}
            </Text>
            <Text
              selectable
              style={[
                type.body,
                { color: "rgba(255,255,255,.62)", textAlign: "center" },
              ]}
            >
              {t("A year of results, habits and momentum — told back to you.")}
            </Text>
          </View>
        );
      case "headline":
        return (
          <View style={{ gap: space.xl }}>
            <Eyebrow>{t("The headline")}</Eyebrow>
            <Text
              selectable
              style={{
                color: "white",
                fontSize: width < 360 ? 52 : 64,
                fontWeight: "800",
                textAlign: "center",
                fontVariant: ["tabular-nums"],
              }}
            >
              {mark(review.average, scale, decimals)}
            </Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <GlassStat
                label={t("Grades recorded")}
                value={String(review.gradeCount)}
              />
              <GlassStat
                label={t("Results added up")}
                value={formatNumber(review.ratioSum * scale, 0)}
              />
            </View>
            {review.firstGradeAt && review.lastGradeAt ? (
              <Text
                selectable
                style={[
                  type.footnote,
                  { color: "rgba(255,255,255,.52)", textAlign: "center" },
                ]}
              >
                {formatDate(review.firstGradeAt, "short")} →{" "}
                {formatDate(review.lastGradeAt, "short")}
              </Text>
            ) : null}
          </View>
        );
      case "heatmap":
        return (
          <View style={{ gap: space.xl }}>
            <Eyebrow>{t("Your rhythm")}</Eyebrow>
            <Text
              selectable
              style={[type.title, { color: "white", textAlign: "center" }]}
            >
              {t("Every square is a day you showed up")}
            </Text>
            <View
              style={{ flexDirection: "row", justifyContent: "center", gap: 3 }}
            >
              {heatmapWeeks.map((week, weekIndex) => (
                <View key={weekIndex} style={{ gap: 3 }}>
                  {week.map((day) => (
                    <View
                      key={day.date}
                      accessibilityLabel={t("{date}: {count} grades", {
                        count: String(day.count),
                        date: day.date,
                      })}
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 3,
                        backgroundColor:
                          day.count === 0
                            ? "rgba(255,255,255,.08)"
                            : day.count === 1
                              ? "rgba(110,231,183,.45)"
                              : day.count === 2
                                ? "rgba(52,211,153,.72)"
                                : "#34D399",
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <GlassStat
                label={t("Busiest month")}
                value={
                  review.busiestMonth
                    ? monthName(review.busiestMonth.month)
                    : "—"
                }
              />
              <GlassStat
                label={t("Favorite day")}
                value={
                  review.busiestWeekday
                    ? (weekdays[review.busiestWeekday.weekday] ?? "—")
                    : "—"
                }
              />
            </View>
          </View>
        );
      case "streak":
        return (
          <View style={{ alignItems: "center", gap: space.xl }}>
            <Eyebrow>{t("Your longest streak")}</Eyebrow>
            <Text style={{ fontSize: 76 }}>🔥</Text>
            <Text
              selectable
              style={{
                color: "white",
                fontSize: 72,
                lineHeight: 78,
                fontWeight: "800",
                fontVariant: ["tabular-nums"],
              }}
            >
              {review.longestStreak}
            </Text>
            <Text
              selectable
              style={[type.title, { color: "rgba(255,255,255,.74)" }]}
            >
              {review.longestStreak === 1
                ? t("active day")
                : t("active days in a row")}
            </Text>
          </View>
        );
      case "prime":
        return review.primeTime ? (
          <View style={{ alignItems: "center", gap: space.xl }}>
            <Eyebrow>{t("Prime time")}</Eyebrow>
            <Text
              selectable
              style={[type.heading, { color: "rgba(255,255,255,.65)" }]}
            >
              {formatDate(review.primeTime.date)}
            </Text>
            <View
              style={{
                width: 210,
                height: 210,
                borderRadius: 105,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(96,165,250,.12)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,.18)",
                boxShadow: "0 0 60px rgba(96,165,250,.25)",
              }}
            >
              <Text
                selectable
                style={{ color: "white", fontSize: 42, fontWeight: "800" }}
              >
                {mark(review.primeTime.ratio, scale, decimals)}
              </Text>
            </View>
            <Text
              selectable
              style={[
                type.body,
                { color: "rgba(255,255,255,.58)", textAlign: "center" },
              ]}
            >
              {t("The day your running average reached its high point.")}
            </Text>
          </View>
        ) : null;
      case "subjects":
        return (
          <View style={{ gap: space.lg }}>
            <Eyebrow>{t("Your strongest subjects")}</Eyebrow>
            {review.topSubjects.map((subject, subjectIndex) => (
              <View
                key={subject.subjectId}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  minHeight: 72,
                  borderRadius: 18,
                  borderCurve: "continuous",
                  backgroundColor: "rgba(255,255,255,.09)",
                  paddingHorizontal: space.lg,
                }}
              >
                <Text
                  selectable
                  style={[
                    type.title,
                    { width: 28, color: "rgba(255,255,255,.45)" },
                  ]}
                >
                  {subjectIndex + 1}
                </Text>
                <Text
                  selectable
                  numberOfLines={2}
                  style={[type.heading, { flex: 1, color: "white" }]}
                >
                  {subject.name}
                </Text>
                <Text
                  selectable
                  style={[
                    type.heading,
                    { color: "white", fontVariant: ["tabular-nums"] },
                  ]}
                >
                  {mark(subject.ratio, scale, decimals)}
                </Text>
              </View>
            ))}
          </View>
        );
      case "progression":
        return review.bestProgression ? (
          <View style={{ alignItems: "center", gap: space.xl }}>
            <Eyebrow>{t("The turnaround")}</Eyebrow>
            <Text style={{ fontSize: 66 }}>↗️</Text>
            <Text
              selectable
              style={[type.display, { color: "white", textAlign: "center" }]}
            >
              {review.bestProgression.name}
            </Text>
            <Text
              selectable
              style={{
                color: "#6EE7B7",
                fontSize: 52,
                fontWeight: "800",
                fontVariant: ["tabular-nums"],
              }}
            >
              +{formatNumber(review.bestProgression.delta * 100, 0)}%
            </Text>
            <Text
              selectable
              style={[
                type.body,
                { color: "rgba(255,255,255,.58)", textAlign: "center" },
              ]}
            >
              {t(
                "Your biggest improvement between the two halves of the year.",
              )}
            </Text>
          </View>
        ) : null;
      case "award":
        return (
          <View style={{ alignItems: "center", gap: space.lg }}>
            <Eyebrow>{t("The title you earned")}</Eyebrow>
            <Text style={{ fontSize: 80 }}>{awardEmoji(review.award)}</Text>
            <Text
              selectable
              style={[type.display, { color: "white", textAlign: "center" }]}
            >
              {awardTitle(review.award)}
            </Text>
            <Text
              selectable
              style={[
                type.body,
                {
                  maxWidth: 320,
                  color: "rgba(255,255,255,.66)",
                  textAlign: "center",
                },
              ]}
            >
              {awardBlurb(review.award)}
            </Text>
          </View>
        );
      case "percentile":
        return (
          <View style={{ alignItems: "center", gap: space.xl }}>
            <Eyebrow>{t("Your activity rank")}</Eyebrow>
            <Text style={{ fontSize: 70 }}>🌟</Text>
            <Text
              selectable
              style={{
                color: "white",
                fontSize: 64,
                fontWeight: "800",
                fontVariant: ["tabular-nums"],
              }}
            >
              {t("Top {percent}%", { percent: String(review.topPercentile) })}
            </Text>
            <Text
              selectable
              style={[
                type.body,
                {
                  maxWidth: 310,
                  color: "rgba(255,255,255,.58)",
                  textAlign: "center",
                },
              ]}
            >
              {t(
                "This compares the habit of recording results, never anyone's grades.",
              )}
            </Text>
          </View>
        );
      case "finale":
        return (
          <View style={{ gap: space.lg, width: "100%" }}>
            <View
              collapsable={false}
              ref={shareCardRef}
              style={{
                aspectRatio: 1,
                justifyContent: "space-between",
                borderRadius: 28,
                borderCurve: "continuous",
                backgroundColor: "#172033",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,.14)",
                padding: space.xl,
                boxShadow: "0 20px 60px rgba(0,0,0,.35)",
              }}
            >
              <View style={{ gap: space.xs }}>
                <Text
                  selectable
                  style={[type.label, { color: "rgba(255,255,255,.5)" }]}
                >
                  AVERMATE · {year.name}
                </Text>
                <Text selectable style={[type.title, { color: "white" }]}>
                  {userName}
                </Text>
              </View>
              <Text style={{ fontSize: 56, textAlign: "center" }}>
                {awardEmoji(review.award)}
              </Text>
              <Text
                selectable
                style={[type.display, { color: "white", textAlign: "center" }]}
              >
                {mark(review.average, scale, decimals)}
              </Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <GlassStat
                  label={t("Grades")}
                  value={String(review.gradeCount)}
                />
                <GlassStat
                  label={t("Longest streak")}
                  value={String(review.longestStreak)}
                />
              </View>
              <Text
                selectable
                style={[
                  type.footnote,
                  { color: "rgba(255,255,255,.48)", textAlign: "center" },
                ]}
              >
                {awardTitle(review.award)} · avermate.fr
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(exporting)}
                onPress={() => void exportRecap("share")}
                style={{
                  flex: 1,
                  minHeight: 50,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 14,
                  backgroundColor: "white",
                }}
              >
                <Text style={[type.heading, { color: "#111827" }]}>
                  {exporting === "share" ? t("Preparing…") : t("Share")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(exporting)}
                onPress={() => void exportRecap("save")}
                style={{
                  flex: 1,
                  minHeight: 50,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 14,
                  backgroundColor: "rgba(255,255,255,.1)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,.15)",
                }}
              >
                <Text style={[type.heading, { color: "white" }]}>
                  {exporting === "save" ? t("Saving…") : t("Save image")}
                </Text>
              </Pressable>
            </View>
          </View>
        );
    }
  })();

  return (
    <GestureDetector gesture={swipe}>
      <View style={{ flex: 1, backgroundColor: slideBackground[current.key] }}>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -90,
            right: -110,
            width: 300,
            height: 300,
            borderRadius: 150,
            backgroundColor: "rgba(167,139,250,.16)",
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: -100,
            left: -100,
            width: 280,
            height: 280,
            borderRadius: 140,
            backgroundColor: "rgba(56,189,248,.10)",
          }}
        />

        <View
          style={{
            position: "absolute",
            zIndex: 10,
            top: insets.top + 8,
            left: 12,
            right: 12,
            gap: space.sm,
          }}
        >
          <View style={{ flexDirection: "row", gap: 4 }}>
            {slides.map((item, itemIndex) => (
              <View
                accessibilityLabel={t("Slide {current} of {total}", {
                  current: String(itemIndex + 1),
                  total: String(slides.length),
                })}
                key={item.key}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 999,
                  overflow: "hidden",
                  backgroundColor: "rgba(255,255,255,.2)",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${
                      itemIndex < index
                        ? 100
                        : itemIndex === index
                          ? progress * 100
                          : 0
                    }%`,
                    backgroundColor: "white",
                  }}
                />
              </View>
            ))}
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Pressable
              accessibilityLabel={t("Close recap")}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={{ padding: space.sm }}
            >
              <Icon name="close" size={24} color="white" />
            </Pressable>
            <View style={{ flexDirection: "row" }}>
              <Pressable
                accessibilityLabel={
                  paused ? t("Resume story") : t("Pause story")
                }
                accessibilityRole="button"
                onPress={() => {
                  haptic("selection");
                  setPaused((value) => !value);
                }}
                style={{ padding: space.sm }}
              >
                <Icon
                  name={paused ? "play" : "pause"}
                  size={20}
                  color="white"
                />
              </Pressable>
              <Pressable
                accessibilityLabel={
                  muted ? t("Turn music on") : t("Mute music")
                }
                accessibilityRole="button"
                onPress={() => {
                  haptic("selection");
                  setMuted((value) => !value);
                }}
                style={{ padding: space.sm }}
              >
                <Icon
                  name={muted ? "volume-mute" : "volume-medium"}
                  size={20}
                  color="white"
                />
              </Pressable>
            </View>
          </View>
        </View>

        <Pressable
          accessibilityLabel={t("Previous slide")}
          accessibilityRole="button"
          disabled={index === 0}
          onPress={previous}
          style={{
            position: "absolute",
            zIndex: 1,
            top: insets.top + 86,
            bottom: insets.bottom,
            left: 0,
            width: "30%",
          }}
        />
        <Pressable
          accessibilityLabel={isLast ? t("Last slide") : t("Next slide")}
          accessibilityRole="button"
          disabled={isLast}
          onPress={next}
          style={{
            position: "absolute",
            zIndex: 1,
            top: insets.top + 86,
            bottom: insets.bottom,
            right: 0,
            width: "70%",
          }}
        />

        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(220)}
          key={current.key}
          pointerEvents="box-none"
          style={{
            zIndex: 2,
            flex: 1,
            justifyContent: "center",
            paddingTop: insets.top + 88,
            paddingBottom: Math.max(28, insets.bottom + 12),
            paddingHorizontal: width < 360 ? space.lg : space.xl,
          }}
        >
          {slide}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
