import ExpoModulesCore

/**
 * The iOS half, which can do considerably less than the Android half — and says so rather
 * than pretending otherwise.
 *
 * NPCI's UPI Intent specification is Android-only. iOS has no system handler for `upi://` at
 * all, so there is nothing to enumerate: no equivalent of `queryIntentActivities`, no way to
 * ask "who can take a payment", and no access to another app's icon or display name.
 *
 * What is possible is `canOpenURL` against a hardcoded list of schemes, which needs every
 * scheme declared in `LSApplicationQueriesSchemes` — iOS caps that list at 50 and answers
 * "not installed" for anything missing from it, without saying why.
 *
 * Whether these apps honour the prefilled parameters is undocumented and has historically
 * varied by version, so the QR fallback on the settle-up screen is not a nicety on iOS. It is
 * the path that actually works.
 */
public class UpiModule: Module {
  /// Scheme, then the label to show. Order is the order the picker renders.
  private static let knownApps: [(id: String, scheme: String, label: String)] = [
    ("gpay", "gpay", "Google Pay"),
    ("tez", "tez", "Google Pay"),
    ("phonepe", "phonepe", "PhonePe"),
    ("paytm", "paytmmp", "Paytm"),
    ("bhim", "bhim", "BHIM"),
  ]

  public func definition() -> ModuleDefinition {
    Name("Upi")

    Function("isAvailable") { true }

    AsyncFunction("listUpiApps") { () -> [[String: Any?]] in
      var seenLabels = Set<String>()

      return UpiModule.knownApps.compactMap { app in
        guard let url = URL(string: "\(app.scheme)://"),
              UIApplication.shared.canOpenURL(url) else {
          return nil
        }
        // Google Pay registers two schemes; listing it twice would look like a bug.
        guard seenLabels.insert(app.label).inserted else { return nil }

        // No icon: iOS gives no API for another app's icon, and bundling their marks is
        // exactly what querying was meant to avoid. The picker falls back to the label.
        return ["id": app.id, "label": app.label, "iconBase64": nil]
      }
    }

    AsyncFunction("payViaUpi") { (appId: String, uri: String) -> Bool in
      guard uri.hasPrefix("upi://") else {
        throw NotAUpiUriException(uri)
      }
      guard let app = UpiModule.knownApps.first(where: { $0.id == appId }) else {
        throw UnknownUpiAppException(appId)
      }

      // There is no `upi://` handler, so the scheme is swapped for the app's own. Whether the
      // app then reads pa/pn/am is up to that app.
      let rewritten = uri.replacingOccurrences(of: "upi://", with: "\(app.scheme)://")
      guard let url = URL(string: rewritten), UIApplication.shared.canOpenURL(url) else {
        throw AppCannotHandleUpiException(appId)
      }

      return await withCheckedContinuation { continuation in
        DispatchQueue.main.async {
          UIApplication.shared.open(url, options: [:]) { opened in
            continuation.resume(returning: opened)
          }
        }
      }
    }
  }
}

internal final class NotAUpiUriException: GenericException<String> {
  override var reason: String { "Refusing to launch a non-UPI URI: \(param)" }
}

internal final class UnknownUpiAppException: GenericException<String> {
  override var reason: String { "\(param) is not a UPI app this build knows about" }
}

internal final class AppCannotHandleUpiException: GenericException<String> {
  override var reason: String { "\(param) cannot handle this payment" }
}
