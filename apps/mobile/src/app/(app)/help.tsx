import { useMutation } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { GlassButton, GlassSurface, Toast, color, font, radius } from '@/design';
import { useSession } from '@/features/auth/session';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { submitFeedback } from '@/lib/api';

/**
 * Help and feedback.
 * Ported from design-reference/screens/Hisaab Help.dc.html.
 *
 * The feedback box goes **straight to the developers**, not into a support queue — that is the
 * design doc's promise, and the copy says so because a box that silently files a ticket is
 * worse than no box.
 *
 * One FAQ answer is rewritten. The prototype's "Can I use more than one currency in a group?"
 * answers "not yet — a group holds one currency", which contradicts nothing now but would have
 * described a feature that does not exist: v1 is rupees only, enforced by a CHECK constraint
 * on every money row. The answer says that plainly instead of implying a per-group setting.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: 'How does settling up work?',
    a: 'You pay through your own UPI app, then confirm it here. Chukta records the settlement — it never touches the money, and nobody here can check your bank.',
  },
  {
    q: 'Can I use another currency?',
    a: 'Not yet. Everything is in rupees for now. Nothing about a group is set to INR — the whole app is, so a trip abroad has to wait.',
  },
  {
    q: 'What happens if I delete an expense?',
    a: "It stops counting immediately and every balance recalculates. It isn't erased: the history keeps a record that it was deleted, and by whom.",
  },
  {
    q: 'Is my UPI ID visible to everyone?',
    a: 'Only to people you share a group or an expense with, so they can pay you back. Nobody can look you up by it.',
  },
  {
    q: 'Does anyone get nagged about money?',
    a: 'Only if you send a reminder yourself. Chukta never messages your friends on its own.',
  },
  {
    q: 'What happens to my expenses if I delete my account?',
    a: "They stay, because they're half of what your friends are owed. Your name, photo and UPI ID are removed and you show up as “Deleted user”.",
  },
];

export default function Help() {
  const insets = useSafeAreaInsets();
  const { profile } = useSession();

  // Single-open accordion, like the prototype: two open answers push the rest off screen and
  // the list stops being scannable.
  const [open, setOpen] = useState<number | null>(0);
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const ping = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 3200);
  };

  const send = useMutation({
    mutationFn: () =>
      submitFeedback(profile!.id, message, {
        appVersion: Constants.expoConfig?.version,
        platform: Platform.OS,
      }),
    onSuccess: () => {
      setMessage('');
      ping('Sent. It goes straight to the developer — thank you.');
    },
    onError: (e: Error) => ping(`Couldn't send that — ${e.message}`),
  });

  const toggle = (index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((current) => (current === index ? null : index));
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Help" />

        <View style={styles.faqs}>
          {FAQS.map((faq, i) => (
            <GlassSurface key={faq.q} radius={radius.cardCompact}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open === i }}
                onPress={() => toggle(i)}
                style={styles.question}
              >
                <Text style={styles.questionText}>{faq.q}</Text>
                <Svg
                  width={12}
                  height={8}
                  viewBox="0 0 12 8"
                  fill="none"
                  style={open === i ? styles.chevronOpen : undefined}
                >
                  <Path
                    d="M1 1.5 6 6.5l5-5"
                    stroke={color.textMuted}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>

              {open === i ? <Text style={styles.answer}>{faq.a}</Text> : null}
            </GlassSurface>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Still stuck?</Text>

        <GlassSurface radius={radius.panel} elevation="glass" contentStyle={styles.feedback}>
          <Text style={styles.feedbackNote}>
            This goes straight to the developer, not a support queue. Say what happened —
            there&rsquo;s nobody else to pass it on to.
          </Text>

          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="What went wrong, or what would help?"
            placeholderTextColor={color.textGhost}
            multiline
            numberOfLines={5}
            maxLength={5000}
            textAlignVertical="top"
            accessibilityLabel="Your message"
            style={styles.input}
          />

          <GlassButton
            label={send.isPending ? 'Sending…' : 'Send'}
            variant="primary"
            disabled={message.trim().length < 4 || send.isPending || !profile}
            onPress={() => send.mutate()}
          />
        </GlassSurface>
      </ScrollView>

      <Toast message={toast} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  faqs: { marginTop: 20, gap: 9 },
  question: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 17,
  },
  questionText: { flex: 1, fontFamily: font.medium, fontSize: 15, color: color.cream },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  answer: {
    paddingHorizontal: 17,
    paddingBottom: 16,
    fontFamily: font.light,
    fontSize: 14,
    lineHeight: 21,
    color: color.textSecondary,
  },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 12,
    paddingLeft: 4,
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  feedback: { padding: 20, gap: 14 },
  feedbackNote: {
    fontFamily: font.light,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.textMuted,
  },
  input: {
    minHeight: 118,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 21,
    color: color.cream,
  },
});
