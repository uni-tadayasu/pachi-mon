import XCTest

final class NativeSmokeTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testBundledGameHasWorkingWebPlatform() throws {
        let result = try diagnostics(live: false)
        for key in ["secureContext", "nativeBridge", "gameLoaded", "localStorage", "randomValues", "randomUUID", "webCrypto", "bundledImage", "canvasReadable", "rtcDataChannel"] {
            XCTAssertEqual(result[key] as? Bool, true, "Native WebKit diagnostic failed: \(key). Result: \(result)")
        }
        XCTAssertNil(result["error"], "\(result)")
    }

    /// Uses the shipped PeerJS broker and actual WebRTC data channels, not mocks.
    @MainActor
    func testLivePeerLinkRoundTrip() throws {
        let result = try diagnostics(live: true)
        XCTAssertEqual(result["livePeerLink"] as? Bool, true, "Two-way live PeerLink exchange failed: \(result)")
        XCTAssertNil(result["error"], "\(result)")
    }

    @MainActor
    func testNativePrivacyMenu() {
        let app = XCUIApplication()
        app.launch()
        let menu = app.buttons["native-app-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 20))
        menu.tap()
        let policy = app.buttons["プライバシーポリシー"]
        XCTAssertTrue(policy.waitForExistence(timeout: 5))
        policy.tap()
        XCTAssertTrue(app.navigationBars["プライバシーポリシー"].waitForExistence(timeout: 10))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Native privacy policy"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func diagnostics(live: Bool) throws -> [String: Any] {
        let app = XCUIApplication()
        app.launchArguments = ["--native-smoke-test"] + (live ? ["--native-smoke-live"] : [])
        app.launch()
        let result = app.staticTexts["native-smoke-result"]
        XCTAssertTrue(result.waitForExistence(timeout: 25))
        let complete = NSPredicate(format: "label == %@", "complete")
        let expectation = XCTNSPredicateExpectation(predicate: complete, object: result)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: live ? 95 : 35), .completed)
        let text = try XCTUnwrap(result.value as? String)
        let data = try XCTUnwrap(text.data(using: .utf8))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
