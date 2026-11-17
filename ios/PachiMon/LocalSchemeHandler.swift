import Foundation
import WebKit

private struct BundledResource: Sendable {
    let response: URLResponse
    let data: Data
}

/// Serves only packaged resources. This is not a proxy and never downloads game code.
@MainActor
final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    nonisolated static let scheme = "pachimon"
    nonisolated static let host = "app"
    nonisolated static let home = URL(string: "pachimon://app/index.html")!

    private let root: URL?
    private let workQueue = DispatchQueue(label: "com.kasaisolutions.pachimon.resources", qos: .userInitiated)
    // WebKit calls this handler on the main thread. All delivery and cancellation
    // state stays there, while only immutable file work runs on workQueue.
    private var tasks: [ObjectIdentifier: UUID] = [:]

    override init() {
        root = Bundle.main.url(forResource: "Web", withExtension: nil)?.resolvingSymlinksInPath()
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        let token = UUID()
        tasks[key] = token
        let request = urlSchemeTask.request
        let root = self.root
        workQueue.async { [weak self] in
            let result = Self.resource(for: request, root: root)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.tasks[key] == token else { return }
                switch result {
                case .success(let resource):
                    urlSchemeTask.didReceive(resource.response)
                    guard self.tasks[key] == token else { return }
                    if !resource.data.isEmpty { urlSchemeTask.didReceive(resource.data) }
                    guard self.tasks[key] == token else { return }
                    urlSchemeTask.didFinish()
                case .failure(let error):
                    urlSchemeTask.didFailWithError(error)
                }
                if self.tasks[key] == token { self.tasks.removeValue(forKey: key) }
            }
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // A queued completion must never call a stopped WKURLSchemeTask.
        tasks.removeValue(forKey: ObjectIdentifier(urlSchemeTask as AnyObject))
    }

    private nonisolated static func resource(for request: URLRequest, root: URL?) -> Result<BundledResource, Error> {
        guard let url = request.url, url.scheme == scheme, url.host == host,
              url.user == nil, url.password == nil, url.port == nil,
              request.httpMethod == nil || request.httpMethod == "GET" || request.httpMethod == "HEAD",
              let root else {
            return .failure(URLError(.unsupportedURL))
        }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let path = components.percentEncodedPath.removingPercentEncoding,
              !path.contains("\\"), !path.contains("\0"),
              !path.split(separator: "/", omittingEmptySubsequences: true).contains(where: { $0 == "." || $0 == ".." }) else {
            return .failure(URLError(.noPermissionsToReadFile))
        }
        var relative = path.isEmpty || path == "/" ? "index.html" : String(path.drop(while: { $0 == "/" }))
        if relative.hasSuffix("/") { relative += "index.html" }
        let file = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/") else {
            return .failure(URLError(.noPermissionsToReadFile))
        }
        do {
            let bytes = try Data(contentsOf: file, options: .mappedIfSafe)
            let mime = mimeType(for: file.pathExtension)
            let response = URLResponse(url: url, mimeType: mime, expectedContentLength: bytes.count,
                                       textEncodingName: mime.hasPrefix("text/") || mime == "application/javascript" || mime == "application/json" ? "utf-8" : nil)
            return .success(BundledResource(response: response, data: request.httpMethod == "HEAD" ? Data() : bytes))
        } catch {
            return .failure(error)
        }
    }

    private nonisolated static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html"
        case "css": return "text/css"
        case "js", "mjs": return "application/javascript"
        case "json", "map": return "application/json"
        case "txt": return "text/plain"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "webp": return "image/webp"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "mp3": return "audio/mpeg"
        case "ogg": return "audio/ogg"
        case "wav": return "audio/wav"
        case "mp4": return "video/mp4"
        case "wasm": return "application/wasm"
        case "xml": return "application/xml"
        default: return "application/octet-stream"
        }
    }
}
