// Composite a transparent PNG onto an opaque square canvas.
//
// Exists because iOS rejects an icon with an alpha channel outright, and `sips` cannot flatten
// one — it pads and converts but keeps the channel. CoreGraphics can, and it is already on the
// machine, so this is a dozen lines rather than a dependency.
//
// To regenerate every launcher asset (from apps/mobile/):
//
//   swiftc -O ../../tools/make-icons.swift -o /tmp/mkicon
//   S=assets/brand/chukta-stamp.png; O=assets/icon
//   /tmp/mkicon $S $O/icon.png                  1024 '#0A0405' 0.86
//   /tmp/mkicon $S $O/adaptive-foreground.png   1024 none      0.62
//   /tmp/mkicon $S $O/adaptive-monochrome.png   1024 none      0.62 --alphaOnly
//   /tmp/mkicon $S $O/notification-icon.png      256 none      0.92 --alphaOnly
//   /tmp/mkicon $S $O/splash-icon.png           1024 none      0.55
//
//   icon <in.png> <out.png> <size> <hexBG|none> <contentFraction> [--alphaOnly]
//
// `contentFraction` is how much of the canvas edge the artwork spans. It is the whole reason
// this is parameterised: an iOS icon wants the art nearly edge to edge, while an Android
// adaptive foreground is drawn into a 108dp square of which only the centre 72dp survives every
// mask shape, so its art has to sit inside ~66% or the launcher crops it.
//
// `--alphaOnly` throws the colour away and keeps the silhouette, for the themed-icon
// monochrome layer, which Android tints itself.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func fail(_ m: String) -> Never {
    FileHandle.standardError.write(("error: " + m + "\n").data(using: .utf8)!)
    exit(1)
}

let a = CommandLine.arguments
guard a.count >= 6 else { fail("usage: icon <in> <out> <size> <hex> <fraction> [--alphaOnly]") }
let inPath = a[1], outPath = a[2]
guard let size = Int(a[3]), let fraction = Double(a[5]) else { fail("bad size/fraction") }
let alphaOnly = a.count > 6 && a[6] == "--alphaOnly"

// #RRGGBB, or "none" to keep the canvas transparent — which is what an Android adaptive
// foreground wants, so the launcher can parallax it against the background layer.
var hex = a[4]
let transparent = hex == "none"
if hex.hasPrefix("#") { hex.removeFirst() }
if transparent { hex = "000000" }
guard hex.count == 6, let rgb = Int(hex, radix: 16) else { fail("bad hex \(a[4])") }
let br = Double((rgb >> 16) & 0xFF) / 255.0
let bg = Double((rgb >> 8) & 0xFF) / 255.0
let bb = Double(rgb & 0xFF) / 255.0

guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: inPath) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(src, 0, nil)
else { fail("cannot read \(inPath)") }

// Opaque unless this is the monochrome layer, which must stay transparent for Android to tint,
// or an adaptive foreground, which must stay transparent so the background layer shows through.
let keepAlpha = alphaOnly || transparent
let alphaInfo: CGImageAlphaInfo = keepAlpha ? .premultipliedLast : .noneSkipLast
guard let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: alphaInfo.rawValue
) else { fail("cannot create context") }

ctx.interpolationQuality = .high

if !keepAlpha {
    ctx.setFillColor(red: br, green: bg, blue: bb, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
}

// Fit inside the target box preserving aspect ratio, then centre. Fit rather than fill: the
// wordmark is 3:1 and filling would crop its ends off.
let box = Double(size) * fraction
let scale = min(box / Double(image.width), box / Double(image.height))
let w = Double(image.width) * scale, h = Double(image.height) * scale
let rect = CGRect(x: (Double(size) - w) / 2, y: (Double(size) - h) / 2, width: w, height: h)

if alphaOnly {
    // Draw the artwork's silhouette in flat white: clip to the image (its alpha becomes the
    // mask) and fill. Android recolours this layer, so any colour detail in it is wasted.
    ctx.saveGState()
    ctx.clip(to: rect, mask: image)
    ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
    ctx.fill(rect)
    ctx.restoreGState()
} else {
    ctx.draw(image, in: rect)
}

guard let out = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(
          URL(fileURLWithPath: outPath) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fail("cannot create output") }

CGImageDestinationAddImage(dest, out, nil)
guard CGImageDestinationFinalize(dest) else { fail("cannot write \(outPath)") }
// `keepAlpha`, not `alphaOnly` — the transparent-background mode also keeps a channel, and
// reporting that wrong is exactly the sort of thing that gets an icon rejected on a Friday.
print("wrote \(outPath) \(size)x\(size) alpha=\(keepAlpha)")
