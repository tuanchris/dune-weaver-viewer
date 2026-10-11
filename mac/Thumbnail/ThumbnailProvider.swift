import QuickLookThumbnailing

/// Finder icons: the finished pattern on its table.
final class ThumbnailProvider: QLThumbnailProvider {
    override func provideThumbnail(for request: QLFileThumbnailRequest, _ handler: @escaping (QLThumbnailReply?, Error?) -> Void) {
        do {
            let path = ThrPath(text: String(decoding: try Data(contentsOf: request.fileURL), as: UTF8.self))
            let side = min(request.maximumSize.width, request.maximumSize.height)
            handler(QLThumbnailReply(contextSize: CGSize(width: side, height: side)) { cg in
                cg.scaleBy(x: request.scale, y: request.scale) // the context is in pixels: side × scale
                path.render(cg, side: side)
                return true
            }, nil)
        } catch {
            handler(nil, error)
        }
    }
}
