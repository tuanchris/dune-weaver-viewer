// ThrPath self-check, the cases in mac/Tests/main.swift. CI runs it, and with
// `--thumbnail in.thr out.png` it asks Explorer's thumbnail pipeline (registry,
// COM, the installed provider) for a 256 px thumbnail and saves it.
#include "ThrPath.h"
#include <cstdio>
#include <cstdlib>

#define check(c) do { if (!(c)) { std::printf("FAILED %s:%d: %s\n", __FILE__, __LINE__, #c); std::exit(1); } } while (0)

static bool approx(ThrPath::Point a, double x, double y) { return std::abs(a.x - x) < 1e-9 && std::abs(a.y - y) < 1e-9; }

#ifdef _WIN32
#include <windows.h>
#include <algorithm>
using std::min, std::max; // gdiplus.h wants them, NOMINMAX hides the macros
#include <gdiplus.h>
#include <shobjidl.h>

static int thumbnail(const wchar_t* in, const wchar_t* out) {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    IShellItemImageFactory* factory;
    if (FAILED(SHCreateItemFromParsingName(in, nullptr, IID_PPV_ARGS(&factory)))) return std::printf("no shell item\n"), 1;
    HBITMAP bmp;
    HRESULT hr = factory->GetImage({256, 256}, SIIGBF_THUMBNAILONLY, &bmp);
    if (FAILED(hr)) return std::printf("no thumbnail: 0x%08lx\n", hr), 1;
    DIBSECTION ds;
    GetObjectW(bmp, sizeof ds, &ds);
    ULONG_PTR token;
    Gdiplus::GdiplusStartupInput startup;
    Gdiplus::GdiplusStartup(&token, &startup, nullptr);
    {
        int w = ds.dsBm.bmWidth, h = ds.dsBm.bmHeight, stride = ds.dsBm.bmWidthBytes;
        BYTE* top = (BYTE*)ds.dsBm.bmBits;
        if (ds.dsBmih.biHeight > 0) top += (h - 1) * stride, stride = -stride; // bottom-up
        Gdiplus::Bitmap image(w, h, stride, PixelFormat32bppPARGB, top);
        const CLSID png = {0x557cf406, 0x1a04, 0x11d3, {0x9a, 0x73, 0x00, 0x00, 0xf8, 0x1e, 0xf3, 0x2e}};
        check(image.Save(out, &png) == Gdiplus::Ok);
        std::printf("thumbnail %dx%d saved\n", w, h);
    }
    Gdiplus::GdiplusShutdown(token);
    return 0;
}

int wmain(int argc, wchar_t** argv) {
    if (argc == 4 && !wcscmp(argv[1], L"--thumbnail")) return thumbnail(argv[2], argv[3]);
#else
int main() {
#endif
    // Comments, blank and junk lines skipped; rho clamped.
    ThrPath p("# header\n0 0\n\nnot numbers\n0 1.5 # trailing comment\r\n");
    check(p.lineCount == 2);
    check(approx(p.points.back(), 1, 0)); // rho clamps to 1
    check(std::abs(p.distance.back() - 1) < 1e-9);

    // A half turn at rho 1 is an arc through theta = pi/2 (y down = +sin), not a chord through the centre.
    ThrPath arc("0 1\n3.141592653589793 1");
    check(arc.points.size() > 300);
    check(std::abs(arc.distance.back() - 3.141592653589793) < 0.01); // arc length ~ pi

    // Progress maps by path length: halfway is the top of the arc.
    check(arc.index(0) == 0 && arc.index(1) == arc.points.size() - 1);
    ThrPath::Point mid = arc.points[arc.index(0.5)];
    check(std::abs(mid.x) < 0.01 && std::abs(mid.y - 1) < 1e-4);

    // Empty files don't crash.
    check(ThrPath("").points.empty() && ThrPath("").index(0.5) == 0);
    std::printf("ThrPath checks passed\n");
    return 0;
}
