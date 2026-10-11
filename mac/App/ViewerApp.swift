import SwiftUI
import UniformTypeIdentifiers

@main
struct ViewerApp: App {
    var body: some Scene {
        DocumentGroup(viewing: ThrDocument.self) { file in
            ThrWindow(document: file.document)
        }
        .defaultSize(width: 640, height: 720)
    }
}

/// Fast: the native line player (same as Finder's Quick Look). Sand: sand-weaver's simulation.
enum RenderMode: String {
    case fast, sand
}

struct ThrWindow: View {
    let document: ThrDocument
    @AppStorage("renderMode") private var mode = RenderMode.fast

    var body: some View {
        Group {
            switch mode {
            case .fast: PlayerView(path: document.path, autoplay: true)
            case .sand: SandView(pattern: document.data).frame(minWidth: 320, minHeight: 380)
            }
        }
        .toolbar {
            Picker("Render", selection: $mode) {
                Text("Fast").tag(RenderMode.fast)
                Text("Sand").tag(RenderMode.sand)
            }
            .pickerStyle(.segmented)
            .help("Fast line preview, or the high-fidelity sand simulation")
        }
    }
}

struct ThrDocument: FileDocument {
    static let readableContentTypes = [UTType(exportedAs: "com.duneweaver.thr")]
    let data: Data
    let path: ThrPath

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        self.data = data
        path = ThrPath(text: String(decoding: data, as: UTF8.self))
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        throw CocoaError(.fileWriteNoPermission)
    }
}
