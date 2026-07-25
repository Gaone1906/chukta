import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { GlassButton, Sheet, color, font } from '@/design';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** ISO yyyy-mm-dd in LOCAL time. `toISOString()` would shift the date across UTC midnight. */
export function toISODate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** "Today, 25 Jul" / "Yesterday" / "3 Aug 2025" — the label on the form's date row. */
export function describeDate(iso: string): string {
  const date = fromISODate(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );

  const short = `${date.getDate()} ${MONTHS[date.getMonth()]?.slice(0, 3)}`;
  if (days === 0) return `Today, ${short}`;
  if (days === -1) return `Yesterday, ${short}`;
  if (days === 1) return `Tomorrow, ${short}`;
  return date.getFullYear() === today.getFullYear() ? short : `${short} ${date.getFullYear()}`;
}

/**
 * A month calendar in a sheet.
 *
 * Written rather than pulled in as a dependency: the platform pickers look nothing like this
 * app on either OS, and the only requirement here is picking a day in the recent past — which
 * is a grid, some arithmetic, and no native module.
 */
export function DateSheet({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  value: string;
  onClose: () => void;
  onPick: (iso: string) => void;
}) {
  const selected = fromISODate(value);
  const [cursor, setCursor] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1));

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // JS weeks start on Sunday; the grid starts on Monday, which is how Indian calendars read.
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const todayISO = toISODate(new Date());

  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="When was this?"
      footer={
        <GlassButton
          label="Today"
          variant="secondary"
          onPress={() => {
            onPick(todayISO);
            onClose();
          }}
        />
      }
    >
      <View style={styles.monthRow}>
        <Arrow
          direction="left"
          label="Previous month"
          onPress={() => setCursor(new Date(year, month - 1, 1))}
        />
        <Text style={styles.month}>
          {MONTHS[month]} {year}
        </Text>
        <Arrow
          direction="right"
          label="Next month"
          onPress={() => setCursor(new Date(year, month + 1, 1))}
        />
      </View>

      <View style={styles.grid}>
        {WEEKDAYS.map((d, i) => (
          <Text key={`${d}${i}`} style={styles.weekday}>
            {d}
          </Text>
        ))}

        {cells.map((day, i) => {
          if (day === null) return <View key={`pad${i}`} style={styles.cell} />;
          const iso = toISODate(new Date(year, month, day));
          const isSelected = iso === value;
          const isToday = iso === todayISO;

          return (
            <Pressable
              key={iso}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${day} ${MONTHS[month]} ${year}`}
              style={styles.cell}
              onPress={() => {
                onPick(iso);
                onClose();
              }}
            >
              <View
                style={[
                  styles.dayPill,
                  isSelected ? styles.daySelected : isToday ? styles.dayToday : null,
                ]}
              >
                <Text style={[styles.day, isSelected ? styles.daySelectedText : null]}>{day}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

function Arrow({
  direction,
  label,
  onPress,
}: {
  direction: 'left' | 'right';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={12} onPress={onPress}>
      <Svg width={9} height={15} viewBox="0 0 9 15" fill="none">
        <Path
          d={direction === 'left' ? 'M7.5 1 1.5 7.5l6 6.5' : 'M1.5 1l6 6.5-6 6.5'}
          stroke={color.cream}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  month: { fontFamily: font.medium, fontSize: 16, color: color.cream },
  grid: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap' },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: font.light,
    fontSize: 11,
    letterSpacing: 1,
    color: color.textGhost,
  },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  dayPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayToday: { borderColor: color.glassBorder },
  daySelected: { borderColor: color.owedBorder, backgroundColor: color.owedFill },
  day: { fontFamily: font.regular, fontSize: 14.5, color: color.textSecondary },
  daySelectedText: { fontFamily: font.semibold, color: color.creamWarm },
});
