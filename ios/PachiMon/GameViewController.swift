import UIKit
import WebKit
import SafariServices
import UniformTypeIdentifiers

/// The WebKit game owns gameplay; this controller owns only iOS integration.
final class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate,
                                WKScriptMessageHandler, UIDocumentPickerDelegate {
    private static let maximumSaveBytes = 524_288
    private let contentController = WKUserContentController()
    private var webView: WKWebView!
    private var api: NativeAPIClient?
    private var ready = false
    private var active = true
    private let menuButton = UIButton(type: .system)
    private let progress = UIActivityIndicatorView(style: .medium)
    private let statusLabel = UILabel()
    private var exportedDirectory: URL?
    private let hapticKey = "pachimon.native.haptics"
    #if DEBUG
    private let smokeLabel = UILabel()
    private var smokeStarted = false
    #endif

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(named: "LaunchBackground") ?? .systemBackground
        UserDefaults.standard.register(defaults: [hapticKey: true])
        api = NativeAPIClient { [weak self] message in self?.deliver(message) }

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController = contentController
        configuration.setURLSchemeHandler(LocalSchemeHandler(), forURLScheme: LocalSchemeHandler.scheme)
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsAirPlayForMediaPlayback = false
        configuration.allowsPictureInPictureMediaPlayback = false
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.applicationNameForUserAgent = "PachiMonIOS/" + (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0")
        contentController.add(WeakScriptHandler(self), name: "pachiNative")

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.accessibilityIdentifier = "pachimon-game"
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        let header = UIView()
        header.translatesAutoresizingMaskIntoConstraints = false
        header.backgroundColor = view.backgroundColor
        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "パチモン"
        title.font = .systemFont(ofSize: 16, weight: .bold)
        title.textColor = UIColor(red: 0.09, green: 0.16, blue: 0.24, alpha: 1)
        title.accessibilityTraits = .header
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .systemFont(ofSize: 10, weight: .medium)
        statusLabel.textColor = .secondaryLabel
        statusLabel.text = "起動中…"
        statusLabel.accessibilityIdentifier = "native-game-status"
        progress.translatesAutoresizingMaskIntoConstraints = false
        progress.startAnimating()
        menuButton.translatesAutoresizingMaskIntoConstraints = false
        menuButton.setImage(UIImage(systemName: "ellipsis.circle"), for: .normal)
        menuButton.tintColor = .label
        menuButton.accessibilityLabel = "アプリメニュー"
        menuButton.accessibilityIdentifier = "native-app-menu"
        menuButton.addTarget(self, action: #selector(showMenu), for: .touchUpInside)
        view.addSubview(header)
        view.addSubview(webView)
        [title, statusLabel, progress, menuButton].forEach(header.addSubview)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: safe.topAnchor),
            header.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 44),
            title.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 14),
            title.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: title.trailingAnchor, constant: 10),
            statusLabel.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: progress.leadingAnchor, constant: -8),
            progress.trailingAnchor.constraint(equalTo: menuButton.leadingAnchor, constant: -4),
            progress.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            menuButton.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -4),
            menuButton.widthAnchor.constraint(equalToConstant: 48),
            menuButton.heightAnchor.constraint(equalToConstant: 44),
            menuButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            webView.topAnchor.constraint(equalTo: header.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: safe.bottomAnchor)
        ])
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--native-smoke-test") {
            smokeLabel.translatesAutoresizingMaskIntoConstraints = false
            smokeLabel.accessibilityIdentifier = "native-smoke-result"
            smokeLabel.font = .monospacedSystemFont(ofSize: 8, weight: .regular)
            smokeLabel.text = "pending"
            smokeLabel.backgroundColor = .systemBackground
            view.addSubview(smokeLabel)
            NSLayoutConstraint.activate([
                smokeLabel.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
                smokeLabel.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
                smokeLabel.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
                smokeLabel.heightAnchor.constraint(equalToConstant: 14)
            ])
        }
        #endif
        webView.load(URLRequest(url: LocalSchemeHandler.home))
    }

    deinit {
        contentController.removeScriptMessageHandler(forName: "pachiNative")
        api?.invalidate()
        if let exportedDirectory { try? FileManager.default.removeItem(at: exportedDirectory) }
    }

    func setGameActive(_ isActive: Bool) {
        active = isActive
        guard isViewLoaded else { return }
        if ready { deliver(["type": isActive ? "foreground" : "background"]) }
        webView.setAllMediaPlaybackSuspended(!isActive)
    }

    private func isGameFrame(_ frame: WKFrameInfo) -> Bool {
        guard frame.isMainFrame, let url = frame.request.url,
              url.scheme == LocalSchemeHandler.scheme, url.host == LocalSchemeHandler.host,
              url.port == nil, url.user == nil, url.password == nil,
              url.path == "/index.html" || url.path == "/" else { return false }
        return true
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "pachiNative", isGameFrame(message.frameInfo),
              let body = message.body as? [String: Any], let command = body["command"] as? String else { return }
        switch command {
        case "ready":
            ready = true
            progress.stopAnimating()
            statusLabel.text = "冒険記録はこの端末に保存"
            deliver(["type": active ? "foreground" : "background"])
        case "exportSave":
            guard let json = body["json"] as? String else { return }
            let kind = body["kind"] as? String ?? "adventure"
            guard kind == "adventure" || kind == "playerIdentity" else { return }
            exportSave(json, kind: kind)
        case "importSave": chooseSave()
        case "menu": showMenu()
        case "haptic":
            if UserDefaults.standard.bool(forKey: hapticKey) { UISelectionFeedbackGenerator().selectionChanged() }
        case "copyCode":
            if let code = body["code"] as? String,
               code.range(of: "^[A-Z0-9]{4,8}$", options: .regularExpression) != nil {
                UIPasteboard.general.setItems([[UTType.utf8PlainText.identifier: code]],
                                             options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(600)])
            }
        case "apiRequest": api?.send(body)
        case "cancelAPI": if let id = body["id"] as? String { api?.cancel(id: id) }
        default: break
        }
    }

    private func deliver(_ message: [String: Any]) {
        guard webView != nil, webView.url?.scheme == LocalSchemeHandler.scheme,
              webView.url?.host == LocalSchemeHandler.host,
              let data = try? JSONSerialization.data(withJSONObject: message),
              let json = String(data: data, encoding: .utf8) else { return }
        let literal = json.replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        webView.evaluateJavaScript("window.PachiNative && window.PachiNative.receive(\(literal));", completionHandler: nil)
    }

    @objc private func showMenu() {
        guard presentedViewController == nil else { return }
        let menu = UIAlertController(title: "アプリメニュー", message: "ゲーム内の冒険の設定から、音・表示・プレイヤー情報も変更できます。", preferredStyle: .actionSheet)
        let export = UIAlertAction(title: "冒険記録を書き出す", style: .default) { [weak self] _ in self?.deliver(["type": "requestExport"]) }
        export.isEnabled = ready
        menu.addAction(export)
        let restore = UIAlertAction(title: "冒険記録を読み込む", style: .default) { [weak self] _ in self?.chooseSave() }
        restore.isEnabled = ready
        menu.addAction(restore)
        let settings = UIAlertAction(title: "ゲーム設定・データ削除", style: .default) { [weak self] _ in self?.deliver(["type": "requestSettings"]) }
        settings.isEnabled = ready
        menu.addAction(settings)
        let enabled = UserDefaults.standard.bool(forKey: hapticKey)
        menu.addAction(UIAlertAction(title: enabled ? "操作の振動をオフにする" : "操作の振動をオンにする", style: .default) { [weak self] _ in
            guard let self else { return }
            UserDefaults.standard.set(!enabled, forKey: self.hapticKey)
            if !enabled { UISelectionFeedbackGenerator().selectionChanged() }
        })
        menu.addAction(UIAlertAction(title: "プライバシーポリシー", style: .default) { [weak self] _ in self?.showDocument("privacy.html", title: "プライバシーポリシー") })
        menu.addAction(UIAlertAction(title: "サポート・データ削除", style: .default) { [weak self] _ in self?.showDocument("support.html", title: "サポート・データ削除") })
        menu.addAction(UIAlertAction(title: "アプリの使い方", style: .default) { [weak self] _ in
            self?.showNotice("アプリの使い方", "一人用の冒険はインターネットに接続せずに遊べます。オンライン対戦・交換・お届けものには通信が必要です。\n\n冒険記録はこのアプリの端末内に保存され、ブラウザー版とは別です。ブラウザー版の冒険記録を書き出して、このメニューから読み込めます。アプリ削除や機種変更の前に、記録を書き出して保管してください。\n\n音楽が聞こえないときはゲーム内の音設定と端末の消音・音量を確認してください。\n\nバージョン " + (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") + "\n© 2026 KASAI SOLUTIONS INC.")
        })
        menu.addAction(UIAlertAction(title: "閉じる", style: .cancel))
        menu.popoverPresentationController?.sourceView = menuButton
        menu.popoverPresentationController?.sourceRect = menuButton.bounds
        present(menu, animated: true)
    }

    private func chooseSave() {
        guard ready else { return }
        if let menu = presentedViewController as? UIAlertController {
            menu.dismiss(animated: true) { [weak self] in self?.chooseSave() }
            return
        }
        guard presentedViewController == nil else { return }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            // Read at most the permitted size plus one byte; a crafted large file
            // cannot exhaust memory before validation.
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            let data = try handle.read(upToCount: Self.maximumSaveBytes + 1) ?? Data()
            guard data.count <= Self.maximumSaveBytes,
                  let json = String(data: data, encoding: .utf8),
                  (try JSONSerialization.jsonObject(with: data)) is [String: Any] else {
                showNotice("読み込めません", "512 KiB以下のパチモンのJSON冒険記録を選んでください。")
                return
            }
            deliver(["type": "importSave", "json": json])
        } catch { showNotice("読み込めません", "ファイルを開けませんでした。パチモンから書き出したJSONファイルを選んでください。") }
    }

    private func exportSave(_ json: String, kind: String) {
        if let menu = presentedViewController as? UIAlertController, menu.preferredStyle == .actionSheet {
            menu.dismiss(animated: true) { [weak self] in self?.exportSave(json, kind: kind) }
            return
        }
        guard presentedViewController == nil else { return }
        guard json.utf8.count <= Self.maximumSaveBytes, let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data), object is [String: Any] else {
            showNotice("書き出せません", "冒険記録の形式またはサイズが正しくありません。")
            return
        }
        do {
            if let exportedDirectory { try? FileManager.default.removeItem(at: exportedDirectory) }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("PachiMon-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            exportedDirectory = directory
            let file = directory.appendingPathComponent(kind == "playerIdentity" ? "Pachi_Monsters_Player.json" : "Pachi_Monsters_Save.json")
            try data.write(to: file, options: [.atomic, .completeFileProtection])
            let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = menuButton
            share.popoverPresentationController?.sourceRect = menuButton.bounds
            share.completionWithItemsHandler = { [weak self] _, _, _, _ in
                try? FileManager.default.removeItem(at: directory)
                if self?.exportedDirectory == directory { self?.exportedDirectory = nil }
            }
            present(share, animated: true)
        } catch { showNotice("書き出せません", "ファイルを作れませんでした。端末の空き容量を確認してください。") }
    }

    private func showDocument(_ path: String, title: String) {
        if let menu = presentedViewController as? UIAlertController, menu.preferredStyle == .actionSheet {
            menu.dismiss(animated: true) { [weak self] in self?.showDocument(path, title: title) }
            return
        }
        guard presentedViewController == nil else { return }
        let document = BundledDocumentViewController(path: path, title: title)
        let navigation = UINavigationController(rootViewController: document)
        navigation.modalPresentationStyle = .pageSheet
        present(navigation, animated: true)
    }

    private func showNotice(_ title: String, _ message: String) {
        if let presented = presentedViewController,
           presented is UIDocumentPickerViewController || (presented as? UIAlertController)?.preferredStyle == .actionSheet {
            presented.dismiss(animated: true) { [weak self] in self?.showNotice(title, message) }
            return
        }
        guard presentedViewController == nil else { return }
        let notice = UIAlertController(title: title, message: message, preferredStyle: .alert)
        notice.addAction(UIAlertAction(title: "閉じる", style: .default))
        present(notice, animated: true)
    }

    private func openExternal(_ url: URL) {
        guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              presentedViewController == nil else { return }
        present(SFSafariViewController(url: url), animated: true)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == LocalSchemeHandler.scheme && url.host == LocalSchemeHandler.host,
           url.user == nil, url.password == nil, url.port == nil {
            if navigationAction.targetFrame?.isMainFrame == true && (url.path == "/index.html" || url.path == "/") {
                decisionHandler(.allow); return
            }
            if navigationAction.navigationType == .linkActivated {
                showDocument(String(url.path.dropFirst()), title: "パチモン")
            }
        } else if navigationAction.navigationType == .linkActivated {
            openExternal(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url, navigationAction.navigationType == .linkActivated else { return nil }
        if url.scheme == LocalSchemeHandler.scheme && url.host == LocalSchemeHandler.host {
            showDocument(String(url.path.dropFirst()), title: "パチモン")
        } else { openExternal(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        progress.stopAnimating()
        if !ready { statusLabel.text = "読み込み完了" }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--native-smoke-test") && !smokeStarted {
            smokeStarted = true
            runNativeSmokeCheck()
        }
        #endif
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showLoadFailure() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showLoadFailure() }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { showLoadFailure() }

    private func showLoadFailure() {
        ready = false
        progress.stopAnimating()
        statusLabel.text = "再読み込みが必要です"
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "ゲームを再読み込み", message: "保存済みの冒険記録を残したまま、ゲーム画面を再読み込みします。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "再読み込み", style: .default) { [weak self] _ in
            self?.progress.startAnimating()
            self?.webView.load(URLRequest(url: LocalSchemeHandler.home))
        })
        alert.addAction(UIAlertAction(title: "閉じる", style: .cancel))
        present(alert, animated: true)
    }
}

private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(_ delegate: WKScriptMessageHandler) { self.delegate = delegate }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

#if DEBUG
extension GameViewController {
    /// Executed only in a Debug UI-test launch, against the actual production URL.
    private func runNativeSmokeCheck() {
        let live = ProcessInfo.processInfo.arguments.contains("--native-smoke-live")
        let script = #"""
        const result = {secureContext:window.isSecureContext === true};
        try {
          result.nativeBridge = window.PachiNative?.available === true;
          result.gameLoaded = typeof window.LT?.PeerLink === 'function' && !!document.getElementById('start-btn');
          const key = 'pachi-native-smoke-check';
          localStorage.setItem(key,'roundtrip');
          result.localStorage = localStorage.getItem(key)==='roundtrip';
          localStorage.removeItem(key);
          const random = new Uint8Array(16);
          crypto.getRandomValues(random);
          result.randomValues = random.some(x=>x!==0);
          result.randomUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(crypto.randomUUID());
          const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode('abc'));
          result.webCrypto = [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
          const image = new Image();
          await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('bundled image timed out')),15000);
            image.onload=()=>{clearTimeout(timer);resolve();};
            image.onerror=()=>{clearTimeout(timer);reject(new Error('bundled image failed'));};
            image.src='assets/apple-touch-pixel.png';
          });
          const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
          const context=canvas.getContext('2d');context.drawImage(image,0,0,16,16);
          result.bundledImage=image.naturalWidth>0;
          result.canvasReadable=context.getImageData(0,0,1,1).data.length===4 && canvas.toDataURL().startsWith('data:image/png');
          const peer = new RTCPeerConnection({iceServers:[]});
          try { peer.createDataChannel('native-smoke');result.rtcDataChannel=(await peer.createOffer()).sdp.includes('m=application'); }
          finally { peer.close(); }
          if(includeLive) {
            let host, guest, timer;
            try {
              let gotHost=false,gotGuest=false,complete,failed;
              const exchanged=new Promise((resolve,reject)=>{complete=resolve;failed=reject;});
              exchanged.catch(()=>{});
              const check=()=>{if(gotHost&&gotGuest)complete();};
              host=new LT.PeerLink({onError:failed,onMessage:m=>{if(m.nativeProbe==='guest'){gotHost=true;check();}}});
              guest=new LT.PeerLink({onError:failed,onMessage:m=>{if(m.nativeProbe==='host'){gotGuest=true;check();}}});
              const exchange=async()=>{
                const code=await host.host();await guest.join(code);
                host.send({nativeProbe:'host'});guest.send({nativeProbe:'guest'});
                await exchanged;result.livePeerLink=true;
              };
              const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('live PeerLink timed out')),60000);});
              await Promise.race([exchange(),deadline]);
            } finally {clearTimeout(timer);host?.close();guest?.close();}
          }
        } catch(error) { result.error=String(error?.message||error); }
        return result;
        """#
        webView.callAsyncJavaScript(script, arguments: ["includeLive": live], in: nil, in: .page) { [weak self] outcome in
            guard let self else { return }
            let result: [String: Any]
            switch outcome {
            case .success(let value): result = value as? [String: Any] ?? ["error": "No diagnostic result"]
            case .failure(let error): result = ["error": error.localizedDescription]
            }
            let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
            let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            self.smokeLabel.text = "complete"
            self.smokeLabel.accessibilityValue = text
        }
    }
}
#endif
