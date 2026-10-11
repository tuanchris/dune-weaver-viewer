// Dune Weaver Viewer for Windows: web/ (Fast and Sand pages) in a WebView2 window.
// The web folder is served at https://app.example/ and the pattern's folder at
// https://pattern.example/, which the page fetches through ?thr=.
#include <windows.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <wrl.h>
#include <string>
#include "WebView2.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

static const wchar_t* kName = L"Dune Weaver Viewer";
static ComPtr<ICoreWebView2Controller> controller;

/// Percent-encodes UTF-8, leaving only unreserved characters.
static std::wstring encode(const std::wstring& s) {
    std::string u(WideCharToMultiByte(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0, nullptr, nullptr), 0);
    WideCharToMultiByte(CP_UTF8, 0, s.c_str(), (int)s.size(), u.data(), (int)u.size(), nullptr, nullptr);
    std::wstring out;
    for (unsigned char c : u) {
        if (isalnum(c) || strchr("-._~", c)) out += (wchar_t)c;
        else out += L'%', out += L"0123456789ABCDEF"[c >> 4], out += L"0123456789ABCDEF"[c & 15];
    }
    return out;
}

static std::wstring pickFile() {
    std::wstring path;
    ComPtr<IFileOpenDialog> dialog;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)))) return path;
    COMDLG_FILTERSPEC filter = {L"Sand patterns (*.thr)", L"*.thr"};
    dialog->SetFileTypes(1, &filter);
    ComPtr<IShellItem> item;
    PWSTR name;
    if (SUCCEEDED(dialog->Show(nullptr)) && SUCCEEDED(dialog->GetResult(&item)) && SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &name))) {
        path = name;
        CoTaskMemFree(name);
    }
    return path;
}

static void fit(HWND hwnd) {
    RECT r;
    GetClientRect(hwnd, &r);
    if (controller) controller->put_Bounds(r);
}

/// Dark title bar when Windows apps are set to dark, to match the pages.
static void matchTheme(HWND hwnd) {
    DWORD light = 1, size = sizeof light;
    RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &light, &size);
    BOOL dark = !light;
    DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof dark);
}

static LRESULT CALLBACK proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_SIZE: fit(hwnd); return 0;
    case WM_DPICHANGED: {
        RECT* r = (RECT*)lp;
        SetWindowPos(hwnd, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    case WM_SETFOCUS: if (controller) controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC); return 0;
    case WM_SETTINGCHANGE: matchTheme(hwnd); break;
    case WM_DESTROY: PostQuitMessage(0); return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

static void fail(HWND hwnd, const wchar_t* text) {
    MessageBoxW(hwnd, text, kName, MB_ICONERROR);
    DestroyWindow(hwnd);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int show) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    int argc;
    wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    std::wstring file = argc > 1 ? argv[1] : pickFile();
    if (file.empty()) return 0;
    wchar_t full[MAX_PATH];
    GetFullPathNameW(file.c_str(), MAX_PATH, full, nullptr);
    std::wstring folder = full, name = PathFindFileNameW(full);
    folder.resize(folder.size() - name.size());

    wchar_t exe[MAX_PATH];
    GetModuleFileNameW(nullptr, exe, MAX_PATH);
    PathRemoveFileSpecW(exe);
    std::wstring web = std::wstring(exe) + L"\\web";

    PWSTR local;
    SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local);
    std::wstring data = std::wstring(local) + L"\\" + kName;
    CoTaskMemFree(local);

    WNDCLASSW wc = {};
    wc.lpfnWndProc = proc;
    wc.hInstance = inst;
    wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1));
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"DuneWeaverViewer";
    RegisterClassW(&wc);
    UINT dpi = GetDpiForSystem();
    std::wstring title = name + L" — " + kName;
    HWND hwnd = CreateWindowW(wc.lpszClassName, title.c_str(), WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                              MulDiv(640, dpi, 96), MulDiv(720, dpi, 96), nullptr, nullptr, inst, nullptr);
    matchTheme(hwnd);
    ShowWindow(hwnd, show);

    // Opens fast.html; the page switches to the Sand page if that was the last mode used.
    std::wstring url = L"https://app.example/fast.html?modes&thr=" + encode(L"https://pattern.example/" + encode(name));
    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(nullptr, data.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([=](HRESULT hr, ICoreWebView2Environment* env) {
            if (FAILED(hr)) return fail(hwnd, L"The Microsoft Edge WebView2 Runtime is missing. Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703"), S_OK;
            return env->CreateCoreWebView2Controller(hwnd, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [=](HRESULT hr, ICoreWebView2Controller* c) {
                    ComPtr<ICoreWebView2> view;
                    ComPtr<ICoreWebView2_3> view3;
                    if (FAILED(hr) || FAILED(c->get_CoreWebView2(&view)) || FAILED(view.As(&view3)))
                        return fail(hwnd, L"Couldn't start WebView2."), S_OK;
                    controller = c;
                    view3->SetVirtualHostNameToFolderMapping(L"app.example", web.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY);
                    // Cross-origin, so the pages on app.example can fetch it.
                    view3->SetVirtualHostNameToFolderMapping(L"pattern.example", folder.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                    fit(hwnd);
                    view->Navigate(url.c_str());
                    c->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC); // so space plays straight away
                    return S_OK;
                }).Get());
        }).Get());
    if (FAILED(hr)) fail(hwnd, L"The Microsoft Edge WebView2 Runtime is missing. Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703");

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
