import * as FileSystem from 'expo-file-system/legacy';

import type { QrHandle } from './QrCode';

/**
 * Put the QR in the camera roll.
 *
 * ---------------------------------------------------------------- why this exists
 *
 * The screen used to tell people to screenshot the code — which crops in whatever else is on
 * screen, at whatever resolution the phone happens to be, and leaves them trimming an image
 * before they can send it. The code is vector; there is no reason to photograph it.
 *
 * ---------------------------------------------------------------- the shape of it
 *
 * Three steps, and only the last one needed a new dependency:
 *
 *   1. `QrCode` rasterises itself through react-native-svg's native `toDataURL` — already in
 *      the binary, so the capture is free.
 *   2. Written to the cache directory with `expo-file-system/legacy`, the same import
 *      `features/expenses/receipts.ts` uses. The cache, not documents: once it is in the photo
 *      library our copy is redundant, and the OS can reclaim it whenever it likes.
 *   3. `expo-media-library` writes it to the gallery.
 *
 * `expo-media-library` is `require`d lazily for the reason `rate.ts` and `pickContact.ts`
 * already do it: a top-level import of a native module throws at module scope in a build
 * without it compiled in, and expo-router evaluates every route file to build its route tree —
 * so one absent module blanks the whole app group rather than just this button.
 */

export type SaveResult = 'saved' | 'denied' | 'unsupported' | 'failed';

function mediaLibrary(): typeof import('expo-media-library') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-media-library') as typeof import('expo-media-library');
  } catch {
    return null;
  }
}

/** Whether the button should be offered at all on this build. */
export function qrSaveAvailable(): boolean {
  return mediaLibrary() !== null;
}

export async function saveQrToPhotos(qr: QrHandle | null): Promise<SaveResult> {
  const MediaLibrary = mediaLibrary();
  if (MediaLibrary === null || qr === null) return 'unsupported';

  try {
    /*
     * `writeOnly` matters. Asking for full access would prompt for permission to READ the
     * user's entire photo library in order to add one picture to it — a much bigger ask than
     * the feature needs, and one both stores' reviewers notice.
     */
    const existing = await MediaLibrary.getPermissionsAsync(true);
    let granted = existing.granted;

    if (!granted) {
      if (!existing.canAskAgain) return 'denied';
      granted = (await MediaLibrary.requestPermissionsAsync(true)).granted;
    }
    if (!granted) return 'denied';

    const base64 = await qr.toPngBase64(1024);

    // Timestamped: saving twice should give two files rather than silently overwriting the
    // first, which on a payment code would be an unpleasant surprise.
    const uri = `${FileSystem.cacheDirectory}chukta-upi-${Date.now()}.png`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });

    /*
     * `saveToLibraryAsync`, not `createAssetAsync`. The latter returns an asset we would then
     * have to file into an album, and doing that needs the full read/write grant this function
     * deliberately does not ask for.
     */
    await MediaLibrary.saveToLibraryAsync(uri);

    // Best effort: the copy in the cache has done its job. A failure here is not the user's
    // problem, and the OS will reclaim the directory anyway.
    void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});

    return 'saved';
  } catch {
    return 'failed';
  }
}
