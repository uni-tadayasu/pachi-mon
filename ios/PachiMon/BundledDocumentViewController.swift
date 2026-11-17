import UIKit
import WebKit
import SafariServices

/// A separate, unprivileged reader keeps the running game and its save intact.
final class BundledDocumentViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let path: String
    private var reader: WKWebView!

    init(path: String, title: String) {
        self.path = path
        super.init(nibName: nil, bundle: nil)
        self.title = title
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(LocalSchemeHandler(), forURLScheme: LocalSchemeHandler.scheme)
        // No script message handler is registered in this reader.
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        reader = WKWebView(frame: .zero, configuration: configuration)
        reader.translatesAutoresizingMaskIntoConstraints = false
        reader.navigationDelegate = self
        reader.uiDelegate = self
        view.addSubview(reader)
        NSLayoutConstraint.activate([
            reader.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            reader.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            reader.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            reader.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor)
        ])
        var components = URLComponents()
        components.scheme = LocalSchemeHandler.scheme
        components.host = LocalSchemeHandler.host
        components.path = "/" + path
        if let url = components.url { reader.load(URLRequest(url: url)) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == LocalSchemeHandler.scheme && url.host == LocalSchemeHandler.host && url.user == nil && url.password == nil && url.port == nil {
            if navigationAction.navigationType == .linkActivated && (url.path == "/" || url.path == "/index.html") {
                decisionHandler(.cancel)
                dismiss(animated: true)
            } else {
                decisionHandler(.allow)
            }
        } else {
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated { openExternal(url) }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url else { return nil }
        if url.scheme == LocalSchemeHandler.scheme && url.host == LocalSchemeHandler.host {
            if url.path == "/" || url.path == "/index.html" { dismiss(animated: true) }
            else { reader.load(URLRequest(url: url)) }
        } else { openExternal(url) }
        return nil
    }

    private func openExternal(_ url: URL) {
        guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              presentedViewController == nil else { return }
        present(SFSafariViewController(url: url), animated: true)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        let alert = UIAlertController(title: "ページを開けません", message: "アプリを最新版に更新してから、もう一度お試しください。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "閉じる", style: .default))
        present(alert, animated: true)
    }
}
