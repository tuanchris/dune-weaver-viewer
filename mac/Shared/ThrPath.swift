import CoreGraphics
import Foundation

/// A .thr pattern as the table draws it. Each line is `theta rho`: theta in
/// cumulative (unwrapped) radians, rho 0-1 of the table radius, `#` starts a
/// comment. The ball moves linearly in theta and rho between lines, so a long
/// move is a spiral arc, not a chord; we subdivide in polar space to match.
struct ThrPath {
    /// Unit disc, y down, in Dune Weaver's preview orientation: x = rho cos theta, y = rho sin theta.
    private(set) var points: [CGPoint] = []
    /// Path length up to each point, in table radii.
    private(set) var distance: [Double] = []
    private(set) var lineCount = 0

    /// Longest straight piece of a subdivided move, in table radii.
    private static let step = 0.01

    init(text: String) {
        var last: (theta: Double, rho: Double)?
        for line in text.split(whereSeparator: \.isNewline) {
            let fields = line.prefix { $0 != "#" }.split(whereSeparator: \.isWhitespace)
            guard fields.count >= 2, let theta = Double(fields[0]), let r = Double(fields[1]) else { continue }
            let rho = min(max(r, 0), 1)
            lineCount += 1
            let a = last ?? (theta, rho)
            let n = max(1, Int((max(abs(theta - a.theta) * max(a.rho, rho), abs(rho - a.rho)) / Self.step).rounded(.up)))
            for j in (last == nil ? n : 1)...n {
                let s = Double(j) / Double(n)
                let t = a.theta + (theta - a.theta) * s, p = a.rho + (rho - a.rho) * s
                append(CGPoint(x: p * cos(t), y: p * sin(t)))
            }
            last = (theta, rho)
        }
    }

    private mutating func append(_ p: CGPoint) {
        distance.append((distance.last ?? 0) + (points.last.map { hypot(p.x - $0.x, p.y - $0.y) } ?? 0))
        points.append(p)
    }

    /// Last point the ball has reached after `fraction` of the path length.
    func index(at fraction: Double) -> Int {
        guard let total = distance.last else { return 0 }
        let target = fraction * total
        var lo = 0, hi = distance.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if distance[mid] <= target { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    // MARK: Drawing (shared by the player, Quick Look preview and Finder thumbnails)

    /// Margin so grooves at rho 1 stay inside the table's rim.
    static let inset: CGFloat = 0.96

    /// Maps the unit disc onto a `side`-square y-up CG context and sets the groove style.
    static func fit(_ cg: CGContext, side: CGFloat) {
        let r = side / 2 * inset
        cg.translateBy(x: side / 2, y: side / 2)
        cg.scaleBy(x: r, y: -r)
        cg.setLineWidth(max(1, side / 600) / r)
        cg.setLineCap(.round)
        cg.setLineJoin(.round)
        cg.setStrokeColor(Sand.groove)
    }

    func stroke(_ cg: CGContext, from start: Int, through end: Int) {
        guard start < end, end < points.count else { return }
        cg.addLines(between: Array(points[start...end]))
        cg.strokePath()
    }

    /// The finished pattern on its table, for thumbnails.
    func render(_ cg: CGContext, side: CGFloat) {
        cg.setFillColor(Sand.table)
        cg.fillEllipse(in: CGRect(x: 0, y: 0, width: side, height: side))
        Self.fit(cg, side: side)
        stroke(cg, from: 0, through: points.count - 1)
    }
}

enum Sand {
    static let table = CGColor(srgbRed: 0.91, green: 0.86, blue: 0.77, alpha: 1)
    static let groove = CGColor(srgbRed: 0.42, green: 0.33, blue: 0.22, alpha: 1)
    static let ball = CGColor(srgbRed: 0.22, green: 0.22, blue: 0.24, alpha: 1)
}
