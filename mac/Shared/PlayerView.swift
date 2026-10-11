import SwiftUI

/// The pattern drawn as the ball moves at constant speed, with play/pause, scrubbing and speed.
struct PlayerView: View {
    let path: ThrPath
    @State private var progress: Double
    @State private var playing: Bool
    @State private var speed = 1.0
    @State private var ink = Ink()
    @Environment(\.displayScale) private var scale

    /// Seconds for the whole pattern at 1x.
    private static let duration = 30.0

    init(path: ThrPath, autoplay: Bool) {
        self.path = path
        _progress = State(initialValue: autoplay ? 0 : 1)
        _playing = State(initialValue: autoplay && !path.points.isEmpty)
    }

    var body: some View {
        VStack(spacing: 12) {
            TimelineView(.animation(paused: !playing)) { timeline in
                Canvas { gc, size in draw(gc, size: size) }
                    .onChange(of: timeline.date) { old, new in
                        // Clamp so resuming after a pause doesn't jump by the paused time.
                        progress = min(1, progress + min(new.timeIntervalSince(old), 0.1) * speed / Self.duration)
                        if progress >= 1 { playing = false }
                    }
            }
            .aspectRatio(1, contentMode: .fit)
            .accessibilityLabel("Sand table pattern, \(Int(progress * 100)) percent drawn")

            HStack(spacing: 12) {
                Button {
                    if progress >= 1 { progress = 0 }
                    playing.toggle()
                } label: {
                    Image(systemName: playing ? "pause.fill" : "play.fill").frame(width: 16)
                }
                .keyboardShortcut(.space, modifiers: [])
                .accessibilityLabel(playing ? "Pause" : "Play")

                Slider(value: $progress, in: 0...1)
                    .accessibilityLabel("Progress")

                Picker("Speed", selection: $speed) {
                    ForEach([0.25, 0.5, 1, 2, 4, 8], id: \.self) { Text("\($0.formatted())×").tag($0) }
                }
                .labelsHidden()
                .fixedSize()
            }
            .disabled(path.points.isEmpty)

            Text("\(path.lineCount.formatted()) points")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(minWidth: 320, minHeight: 380)
    }

    private func draw(_ gc: GraphicsContext, size: CGSize) {
        let side = min(size.width, size.height)
        let disc = CGRect(x: (size.width - side) / 2, y: (size.height - side) / 2, width: side, height: side)
        gc.fill(Path(ellipseIn: disc), with: .color(Color(cgColor: Sand.table)))
        guard !path.points.isEmpty else { return }

        let end = path.index(at: progress)
        if let image = ink.image(of: path, through: end, pixels: Int(side * scale)) {
            gc.draw(Image(decorative: image, scale: scale), in: disc)
        }
        let r = side / 2 * ThrPath.inset, p = path.points[end], ball = side * 0.012
        gc.fill(Path(ellipseIn: CGRect(x: disc.midX + p.x * r - ball, y: disc.midY + p.y * r - ball, width: ball * 2, height: ball * 2)),
                with: .color(Color(cgColor: Sand.ball)))
    }
}

/// Grooves drawn so far, kept as a bitmap so each frame strokes only the new
/// segments (a full stroke of a 150k-point pattern is ~40 ms). Scrubbing back
/// or resizing redraws from the start.
final class Ink {
    private var cg: CGContext?
    private var drawn = 0

    func image(of path: ThrPath, through end: Int, pixels: Int) -> CGImage? {
        guard pixels > 0 else { return nil }
        if cg?.width != pixels || end < drawn {
            cg = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
                           space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            cg.map { ThrPath.fit($0, side: CGFloat(pixels)) }
            drawn = 0
        }
        guard let cg else { return nil }
        path.stroke(cg, from: drawn, through: end)
        drawn = max(drawn, end)
        return cg.makeImage()
    }
}
