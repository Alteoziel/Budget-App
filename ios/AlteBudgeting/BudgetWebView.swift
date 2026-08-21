import Combine
import SwiftUI
import WebKit

enum BudgetAppConfig {
    static let fallbackStartURL = URL(string: "https://budget-app-mauve-five.vercel.app")!

    static var startURL: URL {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "ALTStartURL") as? String,
            let url = URL(string: raw),
            url.scheme?.lowercased() == "https"
        else {
            return fallbackStartURL
        }
        return url
    }
}

final class BudgetWebSession: ObservableObject {
    @Published var isLoading = true
    @Published var hasRenderedPage = false
    @Published var lastError: String?

    fileprivate weak var webView: WKWebView?

    func attach(_ webView: WKWebView) {
        self.webView = webView
        if webView.url == nil {
            webView.load(URLRequest(url: BudgetAppConfig.startURL))
        }
    }

    func reload() {
        lastError = nil
        isLoading = true
        if let webView, webView.url != nil {
            webView.reload()
        } else {
            webView?.load(URLRequest(url: BudgetAppConfig.startURL))
        }
    }

    fileprivate func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }
}

struct BudgetWebView: UIViewRepresentable {
    @ObservedObject var session: BudgetWebSession

    func makeCoordinator() -> Coordinator {
        Coordinator(session: session)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.allowsInlineMediaPlayback = true
        config.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.backgroundColor = UIColor(red: 8 / 255, green: 12 / 255, blue: 11 / 255, alpha: 1)
        webView.isOpaque = false
        webView.backgroundColor = webView.scrollView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        session.attach(webView)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.session = session
        session.attach(uiView)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var session: BudgetWebSession

        init(session: BudgetWebSession) {
            self.session = session
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            session.onMain { [session] in
                session.isLoading = true
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            session.onMain { [session] in
                session.isLoading = false
                session.hasRenderedPage = true
                session.lastError = nil
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "http" || scheme == "https" || scheme == "about" || scheme.isEmpty {
                decisionHandler(.allow)
                return
            }
            if UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }
            return nil
        }

        private func report(_ error: Error) {
            let urlError = error as NSError
            if urlError.domain == NSURLErrorDomain, urlError.code == NSURLErrorCancelled {
                return
            }
            let message = error.localizedDescription
            session.onMain { [session] in
                session.isLoading = false
                session.lastError = message
            }
        }
    }
}
