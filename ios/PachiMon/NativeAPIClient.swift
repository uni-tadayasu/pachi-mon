import Foundation

/// A narrow, authenticated JSON transport for the existing game service.
/// Credentials are never attached to any other host or redirected request.
final class NativeAPIClient: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private static let service = "pachi-mon-admin-hub.hisa-0128-1996.chatgpt.site"
    private static let maxBytes = 1_048_576
    private let respond: ([String: Any]) -> Void
    private struct Pending {
        let id: String
        let task: URLSessionDataTask
        var status: Int = 0
        var bytes = Data()
    }
    private var pending: [Int: Pending] = [:]
    private var byID: [String: Int] = [:]
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 15
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()

    init(respond: @escaping ([String: Any]) -> Void) {
        self.respond = respond
        super.init()
    }

    func send(_ message: [String: Any]) {
        guard let id = message["id"] as? String, !id.isEmpty, id.utf8.count <= 96,
              id.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { return }
        guard byID[id] == nil else { return }
        guard pending.count < 8 else { fail(id, "通信が混み合っています。少し待って再試行してください。"); return }
        guard let path = message["path"] as? String, path.utf8.count <= 2048,
              let relative = URLComponents(string: path), relative.scheme == nil,
              relative.host == nil, relative.fragment == nil, relative.user == nil,
              path.hasPrefix("/"), !path.hasPrefix("//"),
              let decoded = relative.percentEncodedPath.removingPercentEncoding,
              decoded.range(of: "^/[A-Za-z0-9_/-]*$", options: .regularExpression) != nil,
              !decoded.contains("//"),
              let method = message["method"] as? String,
              ["GET", "POST", "PATCH", "PUT", "DELETE"].contains(method) else {
            fail(id, "許可されていない通信です。"); return
        }
        var destination = URLComponents()
        destination.scheme = "https"
        destination.host = Self.service
        destination.percentEncodedPath = "/api" + relative.percentEncodedPath
        destination.percentEncodedQuery = relative.percentEncodedQuery
        guard let url = destination.url, url.host == Self.service, url.scheme == "https",
              url.path.hasPrefix("/api/") else { fail(id, "通信先を確認できません。"); return }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = message["body"] {
            guard let body = body as? String, body.utf8.count <= Self.maxBytes,
                  let bytes = body.data(using: .utf8), (try? JSONSerialization.jsonObject(with: bytes)) != nil,
                  method != "GET" else { fail(id, "送信データが正しくありません。"); return }
            request.httpBody = bytes
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token = message["token"] {
            guard let token = token as? String,
                  token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
                fail(id, "認証情報が正しくありません。"); return
            }
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        }
        let task = session.dataTask(with: request)
        pending[task.taskIdentifier] = Pending(id: id, task: task)
        byID[id] = task.taskIdentifier
        task.resume()
    }

    func cancel(id: String) {
        guard let taskID = byID[id], let operation = pending.removeValue(forKey: taskID) else { return }
        byID.removeValue(forKey: id)
        operation.task.cancel()
        fail(id, "通信を中止しました。")
    }

    func invalidate() {
        let operations = Array(pending.values)
        pending.removeAll()
        byID.removeAll()
        for operation in operations { operation.task.cancel() }
        session.invalidateAndCancel()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // The API has no legitimate redirect. Do not follow even a same-host
        // redirect, and never copy bearer credentials to a rewritten request.
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard var operation = pending[dataTask.taskIdentifier] else { completionHandler(.cancel); return }
        guard let http = response as? HTTPURLResponse,
              response.url?.scheme == "https", response.url?.host == Self.service,
              response.expectedContentLength <= Int64(Self.maxBytes) else {
            completionHandler(.cancel)
            finish(dataTask.taskIdentifier, error: "サーバーの応答を安全に受信できませんでした。")
            return
        }
        operation.status = http.statusCode
        pending[dataTask.taskIdentifier] = operation
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard var operation = pending[dataTask.taskIdentifier] else { return }
        guard operation.bytes.count + data.count <= Self.maxBytes else {
            dataTask.cancel()
            finish(dataTask.taskIdentifier, error: "サーバーの応答が大きすぎます。")
            return
        }
        operation.bytes.append(data)
        pending[dataTask.taskIdentifier] = operation
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(task.taskIdentifier, error: error == nil ? nil : "接続できませんでした。通信状態を確認して再試行してください。")
    }

    private func finish(_ taskID: Int, error: String?) {
        guard let operation = pending.removeValue(forKey: taskID) else { return }
        byID.removeValue(forKey: operation.id)
        if let error { fail(operation.id, error); return }
        guard let body = String(data: operation.bytes, encoding: .utf8) else {
            fail(operation.id, "サーバーの応答が正しくありません。"); return
        }
        respond(["type": "apiResponse", "id": operation.id, "status": operation.status, "body": body])
    }

    private func fail(_ id: String, _ message: String) {
        respond(["type": "apiResponse", "id": id, "status": 0, "body": "", "error": message])
    }
}
