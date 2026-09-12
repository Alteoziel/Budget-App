import SwiftUI

@main
struct AlteBudgetingApp: App {
    var body: some Scene {
        WindowGroup {
            BudgetShellView()
                .ignoresSafeArea()
        }
    }
}

struct BudgetShellView: View {
    @StateObject private var session = BudgetWebSession()

    var body: some View {
        ZStack {
            Color(red: 8 / 255, green: 12 / 255, blue: 11 / 255)
                .ignoresSafeArea()

            BudgetWebView(session: session)
                .ignoresSafeArea()

            if session.isLoading && !session.hasRenderedPage {
                ProgressView()
                    .tint(.white)
            }

            if let message = session.lastError, !session.hasRenderedPage {
                VStack(spacing: 16) {
                    Text("Couldn’t load Alte'")
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text(message)
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white.opacity(0.8))
                        .padding(.horizontal, 24)
                    Button("Try again") {
                        session.reload()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(red: 63 / 255, green: 122 / 255, blue: 92 / 255))
                }
            }
        }
        .statusBarHidden(false)
        .preferredColorScheme(.dark)
    }
}
