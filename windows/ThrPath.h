#pragma once
// mac/Shared/ThrPath.swift for Windows: same parse, subdivision and progress
// mapping, checked by check.cpp against the same cases as mac/Tests/main.swift.
#include <algorithm>
#include <charconv>
#include <cmath>
#include <string_view>
#include <vector>

/// A .thr pattern as the table draws it. Each line is `theta rho`: theta in
/// cumulative (unwrapped) radians, rho 0-1 of the table radius, `#` starts a
/// comment. The ball moves linearly in theta and rho between lines, so a long
/// move is a spiral arc, not a chord; we subdivide in polar space to match.
struct ThrPath {
    struct Point { double x, y; };
    /// Unit disc, y down, in Dune Weaver's preview orientation: x = rho cos theta, y = rho sin theta.
    std::vector<Point> points;
    /// Path length up to each point, in table radii.
    std::vector<double> distance;
    int lineCount = 0;

    /// Longest straight piece of a subdivided move, in table radii.
    static constexpr double step = 0.01;

    explicit ThrPath(std::string_view text) {
        bool started = false;
        double lastTheta = 0, lastRho = 0;
        while (!text.empty()) {
            size_t eol = text.find_first_of("\r\n");
            std::string_view line = text.substr(0, eol);
            text = eol == text.npos ? std::string_view{} : text.substr(eol + 1);
            line = line.substr(0, line.find('#'));
            double theta, r;
            if (!field(line, theta) || !field(line, r)) continue;
            double rho = std::clamp(r, 0.0, 1.0);
            lineCount++;
            double aTheta = started ? lastTheta : theta, aRho = started ? lastRho : rho;
            int n = std::max(1, (int)std::ceil(std::max(std::abs(theta - aTheta) * std::max(aRho, rho), std::abs(rho - aRho)) / step));
            for (int j = started ? 1 : n; j <= n; j++) {
                double s = (double)j / n, t = aTheta + (theta - aTheta) * s, p = aRho + (rho - aRho) * s;
                append({p * std::cos(t), p * std::sin(t)});
            }
            started = true;
            lastTheta = theta;
            lastRho = rho;
        }
    }

    /// Last point the ball has reached after `fraction` of the path length.
    size_t index(double fraction) const {
        if (distance.empty()) return 0;
        size_t lo = 0, hi = distance.size() - 1;
        double target = fraction * distance.back();
        while (lo < hi) {
            size_t mid = (lo + hi + 1) / 2;
            if (distance[mid] <= target) lo = mid; else hi = mid - 1;
        }
        return lo;
    }

private:
    void append(Point p) {
        distance.push_back(points.empty() ? 0 : distance.back() + std::hypot(p.x - points.back().x, p.y - points.back().y));
        points.push_back(p);
    }

    /// Next whitespace-separated field of `line` as a whole number, as Swift's Double(_:) reads it.
    static bool field(std::string_view& line, double& out) {
        size_t a = line.find_first_not_of(" \t\f\v");
        if (a == line.npos) return false;
        size_t b = std::min(line.find_first_of(" \t\f\v", a), line.size());
        std::string_view f = line.substr(a, b - a);
        line = line.substr(b);
        if (f.size() > 1 && f[0] == '+') f.remove_prefix(1);
        auto [end, ec] = std::from_chars(f.data(), f.data() + f.size(), out);
        return ec == std::errc{} && end == f.data() + f.size();
    }
};

/// Thumbnail colours, as mac/Shared/ThrPath.swift's `Sand`.
namespace Sand {
    constexpr unsigned table = 0xFFE8DBC4, groove = 0xFF6B5438;
    /// Margin so grooves at rho 1 stay inside the table's rim.
    constexpr double inset = 0.96;
}
