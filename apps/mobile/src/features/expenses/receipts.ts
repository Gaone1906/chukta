import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';
import { translateError } from '@/lib/errors';

/**
 * Attach a photo of the receipt to an expense.
 *
 * ---------------------------------------------------------------- the path is the permission
 *
 * Files go to `receipts/{expense_id}/{uuid}.jpg`, and that first segment is not cosmetic: the
 * storage policies read it back with `storage.foldername(name)[1]` and pass it to
 * `auth_ext.can_read_expense`. So **the folder IS the access check** — a file written under the
 * wrong expense id would be readable by that expense's participants instead of this one's.
 *
 * The bucket is private, so there are no public URLs anywhere; viewing goes through a signed URL
 * minted per view and expiring shortly after.
 *
 * ---------------------------------------------------------------- resized before it leaves
 *
 * A modern phone camera produces 3–8 MB per shot. Uploading that over Indian mobile data to
 * store a picture of a restaurant bill is disrespectful of both the user's data and the storage
 * bill, and nobody ever zooms into a receipt beyond "what does the total say". Compressed at
 * capture (`quality` on the picker) rather than after: re-encoding a decoded 8MP bitmap in JS
 * is slow and memory-hungry on exactly the low-end devices that can least afford it.
 */

/** Anything larger than this is refused rather than silently costing the user their data. */
const MAX_BYTES = 8 * 1024 * 1024;

function pickerModule(): typeof import('expo-image-picker') | null {
  try {
    // Lazily required for the reason in features/tip/rate.ts — a missing native module at
    // module scope blanks the entire expo-router route tree, not just this feature.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-image-picker') as typeof import('expo-image-picker');
  } catch {
    return null;
  }
}

export function receiptsAvailable(): boolean {
  return pickerModule() !== null;
}

export interface PickedReceipt {
  uri: string;
  mimeType: string;
}

/**
 * Take a photo, or choose one.
 *
 * Returns null when the user cancelled or declined — both ordinary, neither an error.
 */
export async function pickReceipt(source: 'camera' | 'library'): Promise<PickedReceipt | null> {
  const Picker = pickerModule();
  if (Picker === null) return null;

  if (source === 'camera') {
    const perm = await Picker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  }

  const result =
    source === 'camera'
      ? await Picker.launchCameraAsync({ quality: 0.6, mediaTypes: ['images'] })
      : await Picker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0]!;
  return { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' };
}

/**
 * Upload one receipt and record it against the expense.
 *
 * **Storage first, row second, and never the reverse.** A row pointing at an object that does
 * not exist renders as a permanently broken image with no way for the user to tell why; an
 * orphaned object nobody references is invisible and cheap, and the bucket sweep can find it by
 * left-joining `expense_attachments`. Given one of the two has to fail first, it should be the
 * one that leaves nothing broken on screen.
 */
export async function uploadReceipt(
  expenseId: string,
  groupId: string | null,
  profileId: string,
  picked: PickedReceipt,
): Promise<string> {
  const info = await FileSystem.getInfoAsync(picked.uri);
  if (info.exists && typeof info.size === 'number' && info.size > MAX_BYTES) {
    throw new Error('That image is too large. Try taking the photo again.');
  }

  const extension = picked.mimeType === 'image/png' ? 'png' : 'jpg';
  // The expense id must be the FIRST path segment — the storage policy reads it. See above.
  const path = `${expenseId}/${crypto.randomUUID()}.${extension}`;

  // `arrayBuffer` rather than a Blob: React Native's Blob does not carry the bytes in a form
  // supabase-js can upload, and the usual workaround (FormData) loses the content type.
  const base64 = await FileSystem.readAsStringAsync(picked.uri, { encoding: 'base64' });
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  const { error: uploadError } = await supabase.storage
    .from('receipts')
    .upload(path, bytes, { contentType: picked.mimeType, upsert: false });

  if (uploadError) throw new Error(uploadError.message);

  const { error } = await supabase.from('expense_attachments').insert({
    expense_id: expenseId,
    group_id: groupId,
    storage_path: path,
    mime_type: picked.mimeType,
    byte_size: bytes.byteLength,
    uploaded_by_profile_id: profileId,
  });

  if (error) {
    // The row failed, so the object is now an orphan. Best-effort cleanup; if this also fails
    // the object is simply unreferenced, which is the harmless direction.
    await supabase.storage.from('receipts').remove([path]);
    throw translateError(error);
  }

  return path;
}

/**
 * A URL for showing one.
 *
 * Signed and short-lived because the bucket is private: a long-lived URL is a capability that
 * outlives the membership it was granted under, so somebody removed from a group would keep a
 * working link to its receipts. Ten minutes is longer than anyone looks at a receipt and short
 * enough that a leaked link is worthless.
 */
export async function receiptUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(storagePath, 600);

  if (error) return null;
  return data.signedUrl;
}
