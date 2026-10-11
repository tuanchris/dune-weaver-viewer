import CoreGraphics

// Parser and geometry self-check: `swiftc Shared/ThrPath.swift Tests/main.swift` (install.sh runs it).
func near(_ a: CGPoint, _ x: Double, _ y: Double) -> Bool { abs(a.x - x) < 1e-9 && abs(a.y - y) < 1e-9 }

// Comments, blank and junk lines skipped; rho clamped.
let p = ThrPath(text: "# header\n0 0\n\nnot numbers\n0 1.5 # trailing comment\r\n")
assert(p.lineCount == 2)
assert(near(p.points.last!, 1, 0), "rho clamps to 1")
assert(abs(p.distance.last! - 1) < 1e-9)

// A half turn at rho 1 is an arc through theta = pi/2 (y down = +sin), not a chord through the centre.
let arc = ThrPath(text: "0 1\n\(Double.pi) 1")
assert(arc.points.count > 300)
assert(abs(arc.distance.last! - .pi) < 0.01, "arc length ~ pi")

// Progress maps by path length: halfway is the top of the arc.
assert(arc.index(at: 0) == 0 && arc.index(at: 1) == arc.points.count - 1)
let mid = arc.points[arc.index(at: 0.5)]
assert(abs(mid.x) < 0.01 && abs(mid.y - 1) < 1e-4)

// Empty files don't crash.
assert(ThrPath(text: "").points.isEmpty && ThrPath(text: "").index(at: 0.5) == 0)
print("ThrPath checks passed")
