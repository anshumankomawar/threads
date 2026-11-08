import SwiftUI

// The fine grid etched into the glass: a dot every few points, drawn once into a tile and repeated, so it costs
// nothing to scroll or resize. Two layers, a dark dot and a lighter one offset by a pixel, so the grid reads as
// pressed into the surface rather than printed on it.
struct DotGrid: View {
  var spacing: CGFloat = 4
  var dot: CGFloat = 1

  var body: some View {
    Canvas { context, size in
      guard let tile = context.resolveSymbol(id: 0) else { return }
      var x: CGFloat = 0
      while x < size.width {
        var y: CGFloat = 0
        while y < size.height {
          context.draw(tile, at: CGPoint(x: x + spacing / 2, y: y + spacing / 2))
          y += spacing
        }
        x += spacing
      }
    } symbols: {
      ZStack {
        Rectangle().fill(.white.opacity(0.10)).frame(width: dot, height: dot).offset(x: 0, y: 0.5)
        Rectangle().fill(.black.opacity(0.55)).frame(width: dot, height: dot)
      }
      .frame(width: spacing, height: spacing)
      .tag(0)
    }
    .allowsHitTesting(false)
  }
}
