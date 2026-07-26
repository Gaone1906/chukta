import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, font, radius } from '@/design';
import { queryKeys } from '@/lib/queryKeys';

import { pickReceipt, receiptUrl, receiptsAvailable, uploadReceipt } from './receipts';

/**
 * The receipts on an expense: a row of thumbnails, a way to add one, and a full-screen viewer.
 *
 * ---------------------------------------------------------------- every URL is signed
 *
 * The bucket is private, so a thumbnail is not a path — it is a signed URL minted per view and
 * expiring in ten minutes. That is why each receipt gets its own query rather than the paths
 * being rendered directly: the URL is a short-lived capability, and treating it as a stable
 * attribute of the receipt would mean caching something designed to stop working.
 *
 * The ten minutes is deliberate. A long-lived URL outlives the membership it was granted under,
 * so somebody removed from a group would keep working links to its receipts — the storage
 * policy would no longer let them mint a new one, but the old one would keep resolving.
 */
export function ReceiptStrip({
  expenseId,
  groupId,
  profileId,
  receipts,
  canEdit,
  onError,
}: {
  expenseId: string;
  groupId: string | null;
  profileId: string;
  receipts: { id: string; storage_path: string; mime_type: string }[];
  canEdit: boolean;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<string | null>(null);

  // One signed URL per receipt. `useQueries` rather than a loop of hooks because the count is
  // data-driven and hooks cannot be called conditionally.
  const urls = useQueries({
    queries: receipts.map((r) => ({
      queryKey: ['receipt-url', r.storage_path],
      queryFn: () => receiptUrl(r.storage_path),
      // Comfortably inside the URL's own ten-minute life, so a stale one is never rendered.
      staleTime: 5 * 60 * 1000,
    })),
  });

  const add = useMutation({
    mutationFn: async (source: 'camera' | 'library') => {
      const picked = await pickReceipt(source);
      if (picked === null) return null;
      return uploadReceipt(expenseId, groupId, profileId, picked);
    },
    onSuccess: (result) => {
      if (result === null) return;   // cancelled, which is not an outcome worth reporting
      void queryClient.invalidateQueries({ queryKey: queryKeys.expense(expenseId) });
    },
    onError: (e: Error) => onError(e.message),
  });

  if (receipts.length === 0 && (!canEdit || !receiptsAvailable())) return null;

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {receipts.map((r, i) => {
          const url = urls[i]?.data ?? null;
          return (
            <Pressable
              key={r.id}
              accessibilityRole="imagebutton"
              accessibilityLabel="View receipt"
              disabled={url === null}
              onPress={() => setViewing(url)}
              style={styles.thumb}
            >
              {url === null ? (
                <View style={styles.thumbPending} />
              ) : (
                <Image source={{ uri: url }} style={styles.thumbImage} resizeMode="cover" />
              )}
            </Pressable>
          );
        })}

        {canEdit && receiptsAvailable() ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Photograph a receipt"
              disabled={add.isPending}
              onPress={() => add.mutate('camera')}
              style={styles.addTile}
            >
              <Text style={styles.addGlyph}>+</Text>
              <Text style={styles.addLabel}>{add.isPending ? 'Adding…' : 'Photo'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose a receipt from your library"
              disabled={add.isPending}
              onPress={() => add.mutate('library')}
              style={styles.addTile}
            >
              <Text style={styles.addGlyph}>▤</Text>
              <Text style={styles.addLabel}>Library</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      {/*
        * Tap anywhere to dismiss. A receipt is a thing you glance at and close, so a chrome-less
        * overlay is the whole interaction — `resizeMode="contain"` rather than a pinch-zoom
        * gesture because a phone screen already shows a bill legibly and a custom zoom is a
        * surprising amount of gesture code for something nobody asked for.
        */}
      <Modal visible={viewing !== null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewing(null)}>
          {viewing !== null ? (
            <Image source={{ uri: viewing }} style={styles.full} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const THUMB = 76;

const styles = StyleSheet.create({
  strip: { gap: 10, paddingVertical: 2 },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.cardCompact,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbPending: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)' },

  addTile: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.cardCompact,
    borderWidth: 1,
    borderColor: 'rgba(184,150,60,0.35)',
    backgroundColor: 'rgba(184,150,60,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addGlyph: { color: color.goldBright, fontSize: 20, lineHeight: 24 },
  addLabel: { fontFamily: font.regular, fontSize: 11, color: color.textMuted },

  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
});
