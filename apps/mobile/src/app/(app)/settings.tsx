import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Toast, color, font } from '@/design';
import { useSession } from '@/features/auth/session';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { Avatar } from '@/features/people/Avatar';
import { DeleteAccountSheet } from '@/features/settings/DeleteAccountSheet';
import { EditFieldSheet } from '@/features/settings/EditFieldSheet';
import { SettingsGroup, SettingsRow, SettingsToggle } from '@/features/settings/SettingsGroup';
import {
  getNotificationPrefs,
  setNotificationPrefs,
  updateMyProfile,
  type NotificationPrefs,
} from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { supabase } from '@/lib/supabase';

/**
 * Settings.
 * Ported from design-reference/screens/Hisaab Settings.dc.html.
 *
 * Every chevron row in the prototype toasts "Edit — demo only". Rather than five more routes,
 * the three account fields open a sheet over this screen: they are one short value each, and a
 * whole screen to change a name is a lot of navigation for very little.
 *
 * Two deliberate departures from the prototype:
 *
 * - Its three notification toggles are a subset. The table has five, and the two it omits
 *   (edits and comments) are the ones people most want to turn off, so all five are here.
 * - Default currency is shown but not editable. v1 is INR-only, enforced by a CHECK constraint
 *   on every money row — offering a picker that cannot work would be a lie about the app.
 */
export default function Settings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, refreshProfile } = useSession();

  const [editing, setEditing] = useState<'name' | 'upi' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const ping = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const prefsQuery = useQuery({
    queryKey: queryKeys.notificationPrefs(),
    queryFn: () => getNotificationPrefs(profile!.id),
    enabled: Boolean(profile),
  });

  const savePrefs = useMutation({
    mutationFn: (next: NotificationPrefs) => setNotificationPrefs(profile!.id, next),
    // Optimistic: a toggle that waits for a round trip before moving feels broken, and there
    // is nothing to reconcile — this row belongs to one person and one device at a time.
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notificationPrefs() });
      const previous = queryClient.getQueryData<NotificationPrefs>(queryKeys.notificationPrefs());
      queryClient.setQueryData(queryKeys.notificationPrefs(), next);
      return { previous };
    },
    onError: (e: Error, _next, context) => {
      queryClient.setQueryData(queryKeys.notificationPrefs(), context?.previous);
      ping(`Couldn't save that — ${e.message}`);
    },
  });

  const saveProfile = useMutation({
    mutationFn: (patch: Parameters<typeof updateMyProfile>[1]) =>
      updateMyProfile(profile!.id, patch),
    onSuccess: async () => {
      await refreshProfile();
      // The name and photo appear on every other screen too.
      await queryClient.invalidateQueries({ queryKey: queryKeys.home() });
      setEditing(null);
    },
    onError: (e: Error) => ping(`Couldn't save — ${e.message}`),
  });

  const changePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      ping('Photo access is off. Turn it on in your phone settings to change it.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0] || !profile) return;

    try {
      const response = await fetch(result.assets[0].uri);
      const bytes = await response.arrayBuffer();
      const path = `${profile.id}/avatar.jpg`;

      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;

      // Cache-busted: the path never changes, so without this the old photo stays on screen.
      const url = `${supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      saveProfile.mutate({ avatar_url: url });
    } catch (e) {
      ping(`Couldn't upload that photo — ${(e as Error).message}`);
    }
  };

  const prefs = prefsQuery.data;
  const setPref = (key: keyof NotificationPrefs) => (value: boolean) => {
    if (!prefs) return;
    savePrefs.mutate({ ...prefs, [key]: value });
  };

  const version = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Settings" />

        <View style={styles.groups}>
          <SettingsGroup title="Account">
            <SettingsRow
              label="Name"
              value={profile?.display_name}
              onPress={() => setEditing('name')}
            />
            <SettingsRow
              label="Photo"
              accessory={
                <Avatar
                  name={profile?.display_name ?? 'You'}
                  url={profile?.avatar_url ?? null}
                  size={34}
                />
              }
              onPress={() => void changePhoto()}
            />
            <SettingsRow
              label="UPI ID"
              value={profile?.upi_vpa}
              onPress={() => setEditing('upi')}
            />
          </SettingsGroup>

          <SettingsGroup title="Notifications">
            <SettingsToggle
              label="New expenses"
              hint="When someone adds to a shared ledger"
              value={prefs?.new_expenses ?? true}
              disabled={!prefs}
              onChange={setPref('new_expenses')}
            />
            <SettingsToggle
              label="Edits"
              hint="Only when your own share changes"
              value={prefs?.expense_edits ?? true}
              disabled={!prefs}
              onChange={setPref('expense_edits')}
            />
            <SettingsToggle
              label="Comments"
              hint="Replies on an expense you're part of"
              value={prefs?.comments ?? true}
              disabled={!prefs}
              onChange={setPref('comments')}
            />
            <SettingsToggle
              label="Settled confirmations"
              hint="When a payment is marked settled"
              value={prefs?.settlements ?? true}
              disabled={!prefs}
              onChange={setPref('settlements')}
            />
            <SettingsToggle
              label="Payment reminders"
              hint="A nudge when a balance sits too long"
              value={prefs?.reminders ?? true}
              disabled={!prefs}
              onChange={setPref('reminders')}
            />
          </SettingsGroup>

          <SettingsGroup title="Preferences">
            {/* Shown, not offered. See the note at the top of this file. */}
            <View style={styles.staticRow}>
              <Text style={styles.staticLabel}>Currency</Text>
              <Text style={styles.staticValue}>₹ INR</Text>
            </View>
          </SettingsGroup>

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirmingDelete(true)}
              hitSlop={8}
            >
              <Text style={styles.delete}>Delete account</Text>
            </Pressable>
            <Text style={styles.version}>Hisaab v{version}</Text>
          </View>
        </View>
      </ScrollView>

      <EditFieldSheet
        visible={editing === 'name'}
        title="Your name"
        hint="This is how you show up in every shared ledger."
        initialValue={profile?.display_name ?? ''}
        placeholder="Aanya Mehra"
        autoCapitalize="words"
        maxLength={80}
        validate={(v) => (v.trim().length < 2 ? 'A name needs at least two characters.' : null)}
        saving={saveProfile.isPending}
        onClose={() => setEditing(null)}
        onSave={(v) => saveProfile.mutate({ display_name: v.trim() })}
      />

      <EditFieldSheet
        visible={editing === 'upi'}
        title="Your UPI ID"
        hint="So friends can pay you back without asking for it. Leave it blank to remove."
        initialValue={profile?.upi_vpa ?? ''}
        placeholder="aanya@okbank"
        autoCapitalize="none"
        keyboardType="email-address"
        maxLength={64}
        allowEmpty
        validate={(v) =>
          v.trim() === '' || /^[\w.\-]{2,64}@[a-zA-Z]{2,32}$/.test(v.trim())
            ? null
            : "That doesn't look like a UPI ID — they're name@bank."
        }
        saving={saveProfile.isPending}
        onClose={() => setEditing(null)}
        onSave={(v) => saveProfile.mutate({ upi_vpa: v.trim() || null })}
      />

      <DeleteAccountSheet
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onDeleted={() => router.replace('/sign-in')}
        onError={ping}
      />

      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  groups: { marginTop: 20, gap: 20 },
  staticRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 17,
  },
  staticLabel: { flex: 1, fontFamily: font.regular, fontSize: 15.5, color: 'rgba(244,237,228,.9)' },
  staticValue: { fontFamily: font.regular, fontSize: 15, color: color.textMuted },
  footer: { alignItems: 'center', gap: 10, paddingVertical: 10 },
  delete: { fontFamily: font.regular, fontSize: 13, color: color.textFaint },
  version: {
    fontFamily: font.light,
    fontSize: 10.5,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
});
