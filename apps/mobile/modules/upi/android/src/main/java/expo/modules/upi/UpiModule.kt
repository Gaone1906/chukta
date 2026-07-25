package expo.modules.upi

import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream

/**
 * Discover and launch UPI apps.
 *
 * Android's own chooser (a bare `Linking.openURL`) already works and is what the app falls
 * back to. This module exists for the thing `Linking` cannot do: name each installed UPI app,
 * show its real icon, and send the payment to that specific package.
 *
 * Using each app's OWN queried icon is not just nicer — it is how the picker avoids shipping
 * GPay/PhonePe/Paytm trademarks as bundled assets, which is what the design's empty icon
 * placeholders would otherwise have required.
 *
 * **Android 11+ package visibility**: `queryIntentActivities` returns an empty list unless the
 * manifest declares a `<queries>` block for the `upi` scheme. Every app then looks
 * uninstalled, with no error to explain it. The config plugin in
 * `plugins/withUpiQueries.js` adds that block; without it this module silently reports that
 * the user has no UPI apps at all.
 */
class UpiModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Upi")

    Function("isAvailable") { true }

    /**
     * Every activity that can handle `upi://pay`, with its label and icon.
     *
     * Icons come back as base64 PNG data URIs rather than file paths: they are small, they
     * avoid a second round trip per app, and there is no cache to invalidate when the user
     * installs or updates a payment app.
     */
    AsyncFunction("listUpiApps") {
      val context = appContext.reactContext ?: throw MissingContextException()
      val pm = context.packageManager
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(UPI_PROBE_URI))

      val resolved: List<ResolveInfo> =
        pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)

      resolved
        .mapNotNull { info ->
          val packageName = info.activityInfo?.packageName ?: return@mapNotNull null
          mapOf(
            "id" to packageName,
            "label" to info.loadLabel(pm).toString(),
            "iconBase64" to runCatching { encodeIcon(info.loadIcon(pm)) }.getOrNull(),
          )
        }
        // Stable order so the picker does not reshuffle between openings; the system's own
        // resolution order is not guaranteed to be stable across launches.
        .sortedBy { it["label"] as? String ?: "" }
    }

    /**
     * Send the payment to one specific app.
     *
     * `FLAG_ACTIVITY_NEW_TASK` is required because the launch originates from a module rather
     * than from an Activity context.
     */
    AsyncFunction("payViaUpi") { packageName: String, uri: String ->
      val context = appContext.reactContext ?: throw MissingContextException()

      if (!uri.startsWith("upi://")) throw NotAUpiUriException(uri)

      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
        setPackage(packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      if (intent.resolveActivity(context.packageManager) == null) {
        throw AppCannotHandleUpiException(packageName)
      }

      context.startActivity(intent)
      true
    }
  }

  /**
   * A probe URI with a syntactically valid payee, because some launchers refuse to resolve a
   * bare `upi://pay`. Nothing is ever paid from it — it exists only to be matched against.
   */
  private val UPI_PROBE_URI = "upi://pay?pa=probe@upi&pn=probe&am=1.00&cu=INR"

  private fun encodeIcon(drawable: Drawable): String {
    val bitmap =
      if (drawable is BitmapDrawable && drawable.bitmap != null) {
        drawable.bitmap
      } else {
        val width = drawable.intrinsicWidth.takeIf { it > 0 } ?: ICON_FALLBACK_SIZE
        val height = drawable.intrinsicHeight.takeIf { it > 0 } ?: ICON_FALLBACK_SIZE
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bmp ->
          val canvas = Canvas(bmp)
          drawable.setBounds(0, 0, canvas.width, canvas.height)
          drawable.draw(canvas)
        }
      }

    val stream = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
    return "data:image/png;base64," +
      Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
  }

  private companion object {
    const val ICON_FALLBACK_SIZE = 96
  }
}

internal class MissingContextException :
  CodedException("ERR_UPI_NO_CONTEXT", "The Android context was not available", null)

internal class NotAUpiUriException(uri: String) :
  CodedException("ERR_UPI_BAD_URI", "Refusing to launch a non-UPI URI: $uri", null)

internal class AppCannotHandleUpiException(packageName: String) :
  CodedException("ERR_UPI_NO_HANDLER", "$packageName cannot handle this payment", null)
