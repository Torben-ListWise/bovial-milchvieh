import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type NormalizedStep = {
  icon: IoniconName;
  label: string;
};

function normalizeStep(step: string): NormalizedStep {
  const s = step.endsWith("…") ? step.slice(0, -1) : step;

  if (
    s.includes("Verlauf") ||
    s.includes("Zeitreihe") ||
    s.includes("Zeitverlauf") ||
    s.includes("Zeitreihendaten")
  )
    return { icon: "trending-up-outline", label: "Zeitverlauf laden" };

  if (
    s.includes("Cashflow") ||
    s.includes("Amortisation") ||
    s.includes("Break-even") ||
    s.includes("Investition") ||
    s.includes("Benchmarks")
  )
    return { icon: "cash-outline", label: "Investition berechnen" };

  if (s.includes("Diagramm"))
    return { icon: "bar-chart-outline", label: "Diagramm erstellen" };

  if (s.includes("alle Kennzahlen") || s.includes("Alle Kennzahlen"))
    return { icon: "calculator-outline", label: "Alle Kennzahlen berechnen" };

  if (
    s.includes("Statistik") ||
    s.includes("Kennzahlen werden") ||
    s.includes("Fruchtbarkeit")
  )
    return { icon: "stats-chart-outline", label: "Statistiken berechnen" };

  if (s.includes("Rangliste"))
    return { icon: "trophy-outline", label: "Rangliste erstellen" };

  if (s.includes("Ausreißer"))
    return { icon: "warning-outline", label: "Ausreißer erkennen" };

  if (
    s.includes("verglichen") ||
    s.includes("aggregiert") ||
    s.includes("nach Gruppe") ||
    s.startsWith("Aggregiere") ||
    s.includes("Daten nach") ||
    s.includes("Ereignisstatistiken")
  )
    return { icon: "layers-outline", label: "Gruppen vergleichen" };

  if (
    s.includes("Stammdaten") ||
    s.includes("Betriebsdokument") ||
    s.includes("Besamungsplanung") ||
    s.startsWith("Lese") ||
    s.startsWith("Lade")
  )
    return { icon: "server-outline", label: "Daten laden" };

  if (
    s.includes("Wissensdatenbank") ||
    s.includes("Handbuch") ||
    s.includes("Kürzel") ||
    s.includes("Informationen")
  )
    return { icon: "book-outline", label: "Nachschlagen" };

  if (
    s.includes("Datenbankabfrage") ||
    s.startsWith("Analyse:") ||
    s.includes("SQL")
  )
    return { icon: "stats-chart-outline", label: "Datenbankabfrage" };

  if (s.includes("Besamungs") || s.includes("Sperma"))
    return { icon: "calculator-outline", label: "Besamungsplan berechnen" };

  if (s.includes("Rückfragen"))
    return { icon: "chatbubble-outline", label: "Rückfragen formulieren" };

  if (s.includes("Datenschema"))
    return { icon: "book-outline", label: "Datenschema lesen" };

  if (s.includes("Generiere") || s.includes("Antwort"))
    return { icon: "cog-outline", label: "Antwort generieren" };

  if (s.includes("Ereignis"))
    return { icon: "server-outline", label: "Ereignis speichern" };

  if (s.startsWith("Überprüfe"))
    return { icon: "search-outline", label: "Überprüfe Ergebnisse" };

  return { icon: "cog-outline", label: step };
}

function PulsingDot({ color, delay }: { color: string; delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.delay(300),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -4],
  });

  return (
    <Animated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: color,
        transform: [{ translateY }],
      }}
    />
  );
}

function AnimatedStepRow({
  icon,
  label,
  count,
  styles,
}: {
  icon: IoniconName;
  label: string;
  count: number;
  styles: ReturnType<typeof buildStyles>;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, []);

  const opacity = anim;
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [6, 0],
  });

  return (
    <Animated.View style={[styles.stepRow, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.stepDot}>
        <Ionicons name={icon} size={10} color="#fff" />
      </View>
      <Text style={styles.stepLabel} numberOfLines={1}>
        {label}
      </Text>
      {count > 1 && <Text style={styles.stepCount}>×{count}</Text>}
    </Animated.View>
  );
}

function AnimatedCurrentStep({
  label,
  styles,
}: {
  label: string;
  styles: ReturnType<typeof buildStyles>;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const prevLabel = useRef<string | null>(null);

  useEffect(() => {
    if (prevLabel.current === label) return;
    prevLabel.current = label;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [label]);

  const opacity = anim;
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [4, 0],
  });

  return (
    <Animated.View style={[styles.activeRow, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.activeDot} />
      <Text style={styles.activeLabel} numberOfLines={1}>
        {label}…
      </Text>
    </Animated.View>
  );
}

function buildStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 8,
    },
    avatarDot: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.primary + "18",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
    },
    bubble: {
      flex: 1,
      backgroundColor: colors.secondary,
      borderRadius: 16,
      borderTopLeftRadius: 4,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 6,
    },
    timelineBody: {
      gap: 0,
    },
    stepRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 3,
    },
    stepDot: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: "#22c55e",
      alignItems: "center",
      justifyContent: "center",
    },
    stepLabel: {
      flex: 1,
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    stepCount: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground + "88",
    },
    activeDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: colors.primary,
    },
    activeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 3,
    },
    activeLabel: {
      flex: 1,
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    connectingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    connectingLabel: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    dotsRow: {
      flexDirection: "row",
      gap: 4,
      alignItems: "center",
    },
    workingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 2,
    },
    workingLabel: {
      flex: 1,
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    connector: {
      position: "absolute",
      left: 8,
      top: 18,
      bottom: 0,
      width: 1,
      backgroundColor: colors.border,
    },
  });
}

type Props = {
  completedSteps: string[];
  currentStep: string | null;
};

export function AgentStepsTimeline({ completedSteps, currentStep }: Props) {
  const colors = useColors();
  const s = buildStyles(colors);

  const dedupedSteps: { icon: IoniconName; label: string; count: number }[] =
    [];
  const labelIndexMap = new Map<string, number>();

  for (const step of completedSteps) {
    const { icon, label } = normalizeStep(step);
    const existing = labelIndexMap.get(label);
    if (existing !== undefined) {
      dedupedSteps[existing].count += 1;
    } else {
      labelIndexMap.set(label, dedupedSteps.length);
      dedupedSteps.push({ icon, label, count: 1 });
    }
  }

  const normalizedCurrent = currentStep ? normalizeStep(currentStep) : null;
  const currentAlreadyCompleted =
    normalizedCurrent !== null && labelIndexMap.has(normalizedCurrent.label);

  const hasSteps = dedupedSteps.length > 0;
  const showCurrentStep = normalizedCurrent && !currentAlreadyCompleted;
  const showConnecting = !normalizedCurrent && !hasSteps;

  return (
    <View style={s.wrap}>
      <View style={s.avatarDot}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>

      <View style={s.bubble}>
        {hasSteps && (
          <View style={{ position: "relative" }}>
            {dedupedSteps.length > 1 && <View style={s.connector} />}
            {dedupedSteps.map(({ icon, label, count }, i) => (
              <AnimatedStepRow
                key={label}
                icon={icon}
                label={label}
                count={count}
                styles={s}
              />
            ))}
          </View>
        )}

        {showCurrentStep ? (
          <AnimatedCurrentStep
            label={normalizedCurrent!.label}
            styles={s}
          />
        ) : showConnecting ? (
          <View style={s.connectingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={s.connectingLabel}>Verbinde mit Agent…</Text>
          </View>
        ) : hasSteps && !currentStep ? (
          <View style={s.workingRow}>
            <View style={s.dotsRow}>
              <PulsingDot color={colors.primary} delay={0} />
              <PulsingDot color={colors.primary} delay={150} />
              <PulsingDot color={colors.primary} delay={300} />
            </View>
            <Text style={s.workingLabel}>Assistent arbeitet…</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
