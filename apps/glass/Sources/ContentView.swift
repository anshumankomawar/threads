import SwiftUI

// What's in the picture: the glass, the grid, a title bar that's a tab and a few glyphs, a prompt floating a little
// above the middle, and a status strip along the bottom. Nothing here does anything; it's the look.
struct ContentView: View {
  @State private var prompt = ""

  var body: some View {
    ZStack {
      // The glass: frosted desktop, pulled down to a dark pane, with the grid pressed into it.
      Frost()
      Color.black.opacity(0.58)
      DotGrid()
      // A soft shadow rising from the bottom, so the picture darkens where the UI's status strip sits.
      LinearGradient(
        stops: [.init(color: .clear, location: 0.45), .init(color: .black.opacity(0.55), location: 1)],
        startPoint: .top, endPoint: .bottom
      )

      VStack(spacing: 0) {
        TitleBar()
        Spacer()
        PromptCard(text: $prompt)
          .frame(maxWidth: 680)
          .padding(.bottom, 120)
        Spacer()
        StatusBar()
      }
    }
    .ignoresSafeArea()
    .preferredColorScheme(.dark)
  }
}

// MARK: - Title bar

private struct TitleBar: View {
  var body: some View {
    HStack(spacing: 10) {
      // Room for the traffic lights the window draws.
      Color.clear.frame(width: 70, height: 1)
      Glyph("sidebar.left")
      Glyph("chevron.left").opacity(0.45)
      Glyph("chevron.right").opacity(0.45)
      Tab(title: "New session")
      Glyph("plus").opacity(0.6)
      Spacer()
      HStack(spacing: 6) {
        Text("+1,226").foregroundStyle(Color(red: 0.42, green: 0.80, blue: 0.47))
        Text("-0").foregroundStyle(Color(red: 0.95, green: 0.42, blue: 0.42))
      }
      .font(.system(size: 11, weight: .medium, design: .monospaced))
      Glyph("magnifyingglass")
      Glyph("square.on.square").overlay(alignment: .topTrailing) {
        Circle().fill(.red).frame(width: 6, height: 6).offset(x: 3, y: -3)
      }
    }
    .padding(.horizontal, 12)
    .frame(height: 44)
  }
}

private struct Tab: View {
  let title: String
  var body: some View {
    HStack(spacing: 8) {
      RoundedRectangle(cornerRadius: 3, style: .continuous)
        .fill(Color(red: 0.93, green: 0.36, blue: 0.30))
        .frame(width: 14, height: 14)
        .overlay(Image(systemName: "asterisk").font(.system(size: 8, weight: .bold)).foregroundStyle(.white))
      Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.9))
    }
    .padding(.horizontal, 10)
    .frame(width: 190, height: 28, alignment: .leading)
    .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
  }
}

private struct Glyph: View {
  let name: String
  init(_ name: String) { self.name = name }
  var body: some View {
    Image(systemName: name)
      .font(.system(size: 12, weight: .medium))
      .foregroundStyle(.white.opacity(0.8))
      .frame(width: 24, height: 24)
  }
}

// MARK: - Prompt

private struct PromptCard: View {
  @Binding var text: String

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("What should we work on in monocode?")
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(.white.opacity(0.92))
        .padding(.leading, 2)

      VStack(alignment: .leading, spacing: 14) {
        TextField("Ask, build, or describe a change…", text: $text, axis: .vertical)
          .textFieldStyle(.plain)
          .font(.system(size: 13))
          .foregroundStyle(.white.opacity(0.9))
          .lineLimit(1...6)

        HStack(spacing: 8) {
          Pill { Image(systemName: "plus") }
          Pill {
            Circle().fill(Color(red: 0.93, green: 0.36, blue: 0.30)).frame(width: 8, height: 8)
            Text("Opus 5.5")
            Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold)).opacity(0.6)
          }
          Pill {
            Image(systemName: "shield.lefthalf.filled").foregroundStyle(Color(red: 0.98, green: 0.76, blue: 0.25))
            Text("Full access")
            Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold)).opacity(0.6)
          }
          Spacer()
          Image(systemName: "chevron.up")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.white.opacity(0.7))
            .frame(width: 24, height: 24)
            .background(.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
      }
      .padding(14)
      .background(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(.white.opacity(0.045))
          .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.white.opacity(0.09), lineWidth: 1))
      )

      HStack(spacing: 16) {
        Label("Current checkout", systemImage: "folder")
        Label("feat/focus-tab-switcher", systemImage: "arrow.triangle.branch")
        Spacer()
        Circle().strokeBorder(.white.opacity(0.35), lineWidth: 1).frame(width: 10, height: 10)
      }
      .font(.system(size: 11))
      .foregroundStyle(.white.opacity(0.6))
      .padding(.horizontal, 2)
    }
  }
}

private struct Pill<Content: View>: View {
  @ViewBuilder let content: Content
  var body: some View {
    HStack(spacing: 6) { content }
      .font(.system(size: 11, weight: .medium))
      .foregroundStyle(.white.opacity(0.85))
      .padding(.horizontal, 8)
      .frame(height: 24)
      .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
  }
}

// MARK: - Status bar

private struct StatusBar: View {
  var body: some View {
    HStack(spacing: 10) {
      Circle().fill(Color(red: 0.93, green: 0.36, blue: 0.30)).frame(width: 6, height: 6)
      Capsule().fill(Color(red: 0.95, green: 0.42, blue: 0.42)).frame(width: 28, height: 3)
      Text("0% · 2h 36m · 51% 5d")
      Image(systemName: "arrow.triangle.2.circlepath")
      Spacer()
      Image(systemName: "play")
      Text("Actions")
      Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold))
      Rectangle().fill(.white.opacity(0.15)).frame(width: 1, height: 12)
      Image(systemName: "chart.bar.fill")
      Text("npm")
    }
    .font(.system(size: 11))
    .foregroundStyle(.white.opacity(0.6))
    .padding(.horizontal, 14)
    .frame(height: 30)
  }
}
