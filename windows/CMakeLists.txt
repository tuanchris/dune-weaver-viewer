# Windows build: the viewer app, the Explorer thumbnail provider and the format checks.
#   cmake -B build -A x64 && cmake --build build --config Release
cmake_minimum_required(VERSION 3.21)
project(DuneWeaverViewer CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreaded$<$<CONFIG:Debug>:Debug>) # static CRT: nothing else to install
add_compile_definitions(UNICODE _UNICODE NOMINMAX)
add_compile_options(/W4 /utf-8)

# WebView2 SDK from NuGet, linked with its static loader so there's no DLL to ship.
set(WEBVIEW2_VERSION 1.0.4191.47)
set(WEBVIEW2 ${CMAKE_BINARY_DIR}/webview2-${WEBVIEW2_VERSION})
if(NOT EXISTS ${WEBVIEW2}/build/native/include/WebView2.h)
  file(DOWNLOAD https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${WEBVIEW2_VERSION} ${WEBVIEW2}.zip STATUS status)
  list(GET status 0 code)
  if(code)
    message(FATAL_ERROR "Downloading the WebView2 SDK failed: ${status}")
  endif()
  file(ARCHIVE_EXTRACT INPUT ${WEBVIEW2}.zip DESTINATION ${WEBVIEW2})
endif()

add_executable(DuneWeaverViewer WIN32 app/App.cpp app/App.rc)
target_include_directories(DuneWeaverViewer PRIVATE ${WEBVIEW2}/build/native/include)
target_link_libraries(DuneWeaverViewer PRIVATE ${WEBVIEW2}/build/native/x64/WebView2LoaderStatic.lib shlwapi dwmapi version)

add_library(DuneWeaverThumbnail SHARED thumbnail/Thumbnail.cpp thumbnail/Thumbnail.def)
target_link_libraries(DuneWeaverThumbnail PRIVATE gdiplus shlwapi)

add_executable(check check.cpp)
target_link_libraries(check PRIVATE gdiplus ole32 shell32)
