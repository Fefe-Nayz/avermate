import { Picker } from "@expo/ui";
import { useRouter } from "expo-router";
import { Line, Row, Section, Text } from "@/components/native";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

/**
 * What you are looking at: which year, and which slice of it.
 *
 * Both answer the same question, so both live in one group. They are native
 * menu pickers rather than a rail of chips — a menu costs one tap to open and
 * shows every option with the current one marked, where a rail hides the
 * options past the right edge and gives no indication that they exist.
 */
export function ScopeBar() {
  const router = useRouter();
  const { years, year, selectYear, periods, period, selectPeriod } = useYear();

  const showYear = years.length > 1;
  const showPeriods = periods.length > 1;
  if (!showYear && !showPeriods) return null;

  return (
    <Section title={t("Showing")}>
      {showYear ? (
        <Line
          leading="year"
          title={t("School year")}
          trailing={
            <Picker
              selectedValue={year?.id ?? ""}
              appearance="menu"
              onValueChange={(next) => {
                haptic("selection");
                selectYear(String(next));
              }}
            >
              {years.map((item) => (
                <Picker.Item key={item.id} label={item.name} value={item.id} />
              ))}
            </Picker>
          }
        />
      ) : null}

      {showPeriods ? (
        <Line
          leading="period"
          title={t("Period")}
          trailing={
            <Picker
              selectedValue={period.id}
              appearance="menu"
              onValueChange={(next) => {
                haptic("selection");
                selectPeriod(String(next));
              }}
            >
              {periods.map((item) => (
                <Picker.Item key={item.id} label={item.name} value={item.id} />
              ))}
            </Picker>
          }
        />
      ) : null}

      {showYear ? (
        <Line
          leading="add"
          title={t("Add a year")}
          onPress={() => router.push("/year/new")}
        />
      ) : null}
    </Section>
  );
}

/**
 * The compact form, for screens whose headline is a number rather than a list.
 * Same two menus, one line, no group around them.
 */
export function ScopeRow() {
  const { years, year, selectYear, periods, period, selectPeriod } = useYear();

  const showYear = years.length > 1;
  const showPeriods = periods.length > 1;
  if (!showYear && !showPeriods) return null;

  return (
    <Row spacing={8}>
      {showYear ? (
        <Picker
          selectedValue={year?.id ?? ""}
          appearance="menu"
          onValueChange={(next) => {
            haptic("selection");
            selectYear(String(next));
          }}
        >
          {years.map((item) => (
            <Picker.Item key={item.id} label={item.name} value={item.id} />
          ))}
        </Picker>
      ) : null}

      {showYear && showPeriods ? (
        <Text size="footnote" tone="faint">
          ·
        </Text>
      ) : null}

      {showPeriods ? (
        <Picker
          selectedValue={period.id}
          appearance="menu"
          onValueChange={(next) => {
            haptic("selection");
            selectPeriod(String(next));
          }}
        >
          {periods.map((item) => (
            <Picker.Item key={item.id} label={item.name} value={item.id} />
          ))}
        </Picker>
      ) : null}
    </Row>
  );
}
