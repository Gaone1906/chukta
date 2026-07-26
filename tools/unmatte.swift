// Recover true straight alpha from two renders of the same artwork — one on black, one on white.
//
//   unmatte <onBlack.png> <onWhite.png> <out.png> [--white]
//
// ---------------------------------------------------------------- why this exists
//
// The icon artwork is authored as SVG and the only SVG rasteriser on this machine is QuickLook
// (`qlmanage -t`), which always composites onto opaque WHITE. There is no flag to keep the
// alpha. So a transparent Android adaptive-icon foreground cannot be produced directly.
//
// Chroma-keying a background colour is the usual hack and it is wrong at every anti-aliased
// edge, which on a 5-unit gold stroke is most of the stroke. This is the exact method instead.
//
// ---------------------------------------------------------------- the algebra
//
// Compositing artwork (colour C, coverage a) over a background B gives  P = C*a + B*(1-a).
// Render twice, over black (B=0) and over white (B=1):
//
//     Pb = C*a                      Pw = C*a + (1 - a)
//     Pw - Pb = 1 - a       =>      a = 1 - (Pw - Pb)
//     C = Pb / a                    (un-premultiply)
//
// Both unknowns fall out with no assumption about what colour the artwork is, which is what
// makes it safe for a ring and a letterform painted in two different golds.
//
// `--white` discards the recovered colour and keeps only `a`, painting flat white. That is the
// Android themed-icon monochrome layer and the notification icon, both of which the system
// recolours anyway — and the notification icon in particular is drawn from the alpha channel
// alone, so any colour in it would be thrown away.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func fail(_ m: String) -> Never {
    FileHandle.standardError.write(("error: " + m + "\n").data(using: .utf8)!)
    exit(1)
}

func load(_ path: String) -> (CGImage, [UInt8], Int, Int) {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
    else { fail("cannot read \(path)") }
    let w = img.width, h = img.height
    var buf = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8,
                              bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { fail("cannot create context for \(path)") }
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return (img, buf, w, h)
}

let a = CommandLine.arguments
guard a.count >= 4 else { fail("usage: unmatte <onBlack.png> <onWhite.png> <out.png> [--white]") }
let flatWhite = a.count > 4 && a[4] == "--white"

let (_, blackBuf, w, h) = load(a[1])
let (_, whiteBuf, w2, h2) = load(a[2])
guard w == w2, h == h2 else { fail("size mismatch: \(w)x\(h) vs \(w2)x\(h2)") }

var out = [UInt8](repeating: 0, count: w * h * 4)

for i in stride(from: 0, to: w * h * 4, by: 4) {
    // Alpha from the luminance difference. Averaging the three channels rather than trusting one
    // keeps a coloured edge pixel from reporting a different coverage per channel.
    var aSum = 0.0
    for c in 0..<3 {
        let pb = Double(blackBuf[i + c]) / 255.0
        let pw = Double(whiteBuf[i + c]) / 255.0
        aSum += 1.0 - (pw - pb)
    }
    let alpha = min(1.0, max(0.0, aSum / 3.0))

    if alpha < 0.004 {           // fully transparent; leave the pixel zeroed
        continue
    }

    if flatWhite {
        out[i] = 255; out[i + 1] = 255; out[i + 2] = 255
    } else {
        for c in 0..<3 {
            let pb = Double(blackBuf[i + c]) / 255.0
            out[i + c] = UInt8(min(255.0, max(0.0, (pb / alpha) * 255.0)))
        }
    }
    out[i + 3] = UInt8(alpha * 255.0)
}

// Premultiplied on write: CoreGraphics expects it, and handing it straight alpha here is what
// produces the dark halo people blame on the exporter.
for i in stride(from: 0, to: w * h * 4, by: 4) {
    let al = Double(out[i + 3]) / 255.0
    for c in 0..<3 { out[i + c] = UInt8(Double(out[i + c]) * al) }
}

guard let ctx = CGContext(data: &out, width: w, height: h, bitsPerComponent: 8,
                          bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
      let img = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(
          URL(fileURLWithPath: a[3]) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fail("cannot write \(a[3])") }

CGImageDestinationAddImage(dest, img, nil)
guard CGImageDestinationFinalize(dest) else { fail("cannot finalize \(a[3])") }
print("wrote \(a[3]) \(w)x\(h) flatWhite=\(flatWhite)")
