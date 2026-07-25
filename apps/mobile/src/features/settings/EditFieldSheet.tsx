import { useState } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps } from 'react-native';

import { GlassButton, Sheet, color, font } from '@/design';

interface Props {
  visible: boolean;
  title: string;
  hint: string;
  initialValue: string;
  placeholder: string;
  maxLength: number;
  saving: boolean;
  allowEmpty?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  keyboardType?: TextInputProps['keyboardType'];
  /** Returns the reason it can't be saved, or null. */
  validate?: (value: string) => string | null;
  onClose: () => void;
  onSave: (value: string) => void;
}

/**
 * One short value, edited over the screen that shows it.
 *
 * A sheet rather than a route because these are single fields — a whole screen with its own
 * back stack to change a name is more navigation than the change is worth, and the value stays
 * visible behind the sheet while you type the replacement.
 */
export function EditFieldSheet(props: Props) {
  // The body is only mounted while open, so its draft is seeded from props on mount and
  // discarded on close. Same reasoning as PayerSheet: that is what makes cancel actually
  // cancel, without an effect that re-seeds and re-renders every time it opens.
  if (!props.visible) return null;
  return <EditFieldBody {...props} />;
}

function EditFieldBody({
  title,
  hint,
  initialValue,
  placeholder,
  maxLength,
  saving,
  allowEmpty = false,
  autoCapitalize = 'sentences',
  keyboardType,
  validate,
  onClose,
  onSave,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);

  const error = validate?.(value) ?? null;
  const empty = value.trim() === '';
  const unchanged = value.trim() === initialValue.trim();
  const canSave = !saving && !error && (allowEmpty || !empty) && !unchanged;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={title}
      subtitle={hint}
      footer={
        <GlassButton
          label={saving ? 'Saving…' : 'Save'}
          variant="primary"
          disabled={!canSave}
          onPress={() => onSave(value)}
        />
      }
    >
      <TextInput
        value={value}
        onChangeText={(next) => {
          setValue(next);
          setTouched(true);
        }}
        placeholder={placeholder}
        placeholderTextColor={color.textGhost}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoFocus
        accessibilityLabel={title}
        style={styles.input}
      />

      {/* Only after they have typed something — telling someone their untouched field is
          wrong the instant the sheet opens is scolding, not helping. */}
      {touched && error ? <Text style={styles.error}>{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
    fontFamily: font.regular,
    fontSize: 16,
    color: color.cream,
  },
  error: { marginTop: 10, fontFamily: font.light, fontSize: 12.5, color: color.creamRose },
});
