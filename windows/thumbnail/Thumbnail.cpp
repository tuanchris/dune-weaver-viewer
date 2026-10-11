// Explorer thumbnails for .thr files: the finished pattern on its table, as
// mac/Thumbnail draws it. An in-process COM server; installer.iss registers it.
#include <windows.h>
#include <algorithm>
using std::min, std::max; // gdiplus.h wants them, NOMINMAX hides the macros
#include <gdiplus.h>
#include <shlwapi.h>
#include <thumbcache.h>
#include <atomic>
#include <new>
#include <string>
#include "../ThrPath.h"

// {CE7AFF1B-5CD9-4088-B83E-0690F024F041}, also in installer.iss.
static const CLSID CLSID_Thumbnail = {0xce7aff1b, 0x5cd9, 0x4088, {0xb8, 0x3e, 0x06, 0x90, 0xf0, 0x24, 0xf0, 0x41}};
static std::atomic<long> live{0};

/// The finished pattern on its table, into a top-down premultiplied BGRA `side`² buffer.
static void render(const ThrPath& path, void* bits, int side) {
    using namespace Gdiplus;
    ULONG_PTR token;
    GdiplusStartupInput startup;
    GdiplusStartup(&token, &startup, nullptr);
    {
        Bitmap bmp(side, side, side * 4, PixelFormat32bppPARGB, (BYTE*)bits);
        Graphics g(&bmp);
        g.SetSmoothingMode(SmoothingModeAntiAlias);
        g.SetPixelOffsetMode(PixelOffsetModeHalf);
        g.Clear(Color(0, 0, 0, 0));
        SolidBrush table{Color(Sand::table)};
        g.FillEllipse(&table, 0.f, 0.f, (REAL)side, (REAL)side);
        Pen groove(Color(Sand::groove), std::max(1.f, side / 600.f));
        groove.SetLineCap(LineCapRound, LineCapRound, DashCapRound);
        groove.SetLineJoin(LineJoinRound);
        // Strokes in pieces: GDI+ outlines a wide polyline as one path, slow at 100k+ points.
        float c = side / 2.f, r = c * (float)Sand::inset;
        std::vector<PointF> pts;
        for (size_t i = 0; i < path.points.size(); i++) {
            pts.emplace_back(c + (float)path.points[i].x * r, c + (float)path.points[i].y * r);
            if (pts.size() == 4096 || i + 1 == path.points.size()) {
                if (pts.size() > 1) g.DrawLines(&groove, pts.data(), (INT)pts.size());
                pts.erase(pts.begin(), pts.end() - 1);
            }
        }
    }
    GdiplusShutdown(token);
}

class Provider : public IInitializeWithStream, public IThumbnailProvider {
    std::atomic<long> refs{1};
    IStream* stream = nullptr;

public:
    Provider() { live++; }
    ~Provider() { if (stream) stream->Release(); live--; }

    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        static const QITAB qit[] = {QITABENT(Provider, IInitializeWithStream), QITABENT(Provider, IThumbnailProvider), {}};
        return QISearch(this, qit, riid, ppv);
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return ++refs; }
    IFACEMETHODIMP_(ULONG) Release() override { long n = --refs; if (!n) delete this; return n; }

    IFACEMETHODIMP Initialize(IStream* s, DWORD) override {
        if (stream) return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
        (stream = s)->AddRef();
        return S_OK;
    }

    IFACEMETHODIMP GetThumbnail(UINT cx, HBITMAP* out, WTS_ALPHATYPE* alpha) override {
        std::string text;
        char buf[1 << 16];
        ULONG n;
        while (SUCCEEDED(stream->Read(buf, sizeof buf, &n)) && n) text.append(buf, n);
        BITMAPINFO bi = {{sizeof(BITMAPINFOHEADER), (LONG)cx, -(LONG)cx, 1, 32}};
        void* bits;
        if (!(*out = CreateDIBSection(nullptr, &bi, DIB_RGB_COLORS, &bits, nullptr, 0))) return E_OUTOFMEMORY;
        render(ThrPath(text), bits, cx);
        *alpha = WTSAT_ARGB;
        return S_OK;
    }
};

class Factory : public IClassFactory {
public:
    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        static const QITAB qit[] = {QITABENT(Factory, IClassFactory), {}};
        return QISearch(this, qit, riid, ppv);
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return 2; } // static instance
    IFACEMETHODIMP_(ULONG) Release() override { return 1; }
    IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
        *ppv = nullptr;
        if (outer) return CLASS_E_NOAGGREGATION;
        Provider* p = new (std::nothrow) Provider;
        if (!p) return E_OUTOFMEMORY;
        HRESULT hr = p->QueryInterface(riid, ppv);
        p->Release();
        return hr;
    }
    IFACEMETHODIMP LockServer(BOOL lock) override { lock ? live++ : live--; return S_OK; }
};

static Factory factory;

STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv) {
    *ppv = nullptr;
    return clsid == CLSID_Thumbnail ? factory.QueryInterface(riid, ppv) : CLASS_E_CLASSNOTAVAILABLE;
}

STDAPI DllCanUnloadNow() { return live ? S_FALSE : S_OK; }
