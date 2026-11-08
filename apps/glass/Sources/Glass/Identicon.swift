import SwiftUI

/// A mirrored 5×5 grid in one seeded colour, clipped to a circle (components/Identicon.tsx), the same FNV-1a hash as
/// the desktop app's, so a person has the same mark in both.
struct Identicon: View {
  let seed: String
  var size: CGFloat = 22

  private var hash: UInt32 {
    var h: UInt32 = 0x811c9dc5
    for unit in seed.utf16 { h = (h ^ UInt32(unit)) &* 0x01000193 }
    return h
  }

  private var cells: [(Int, Int)] {
    let h = hash
    var out: [(Int, Int)] = []
    for row in 0..<5 {
      for col in 0..<3 where (h >> UInt32(row * 3 + col + 9)) & 1 == 1 {
        out.append((col, row))
        if col < 2 { out.append((4 - col, row)) }
      }
    }
    return out
  }

  var body: some View {
    let hue = Double(hash % 360) / 360
    Canvas { context, _ in
      let cell = size / 6
      let origin = cell / 2
      context.fill(Path(ellipseIn: CGRect(x: 0, y: 0, width: size, height: size)), with: .color(Color(red: 0.95, green: 0.95, blue: 0.95)))
      context.clip(to: Path(ellipseIn: CGRect(x: 0, y: 0, width: size, height: size)))
      for (x, y) in cells {
        let rect = CGRect(x: origin + CGFloat(x) * cell, y: origin + CGFloat(y) * cell, width: cell * 1.02, height: cell * 1.02)
        context.fill(Path(rect), with: .color(Color(hue: hue, saturation: 0.55, brightness: 0.52 + 0.3)))
      }
    }
    .frame(width: size, height: size)
  }
}
