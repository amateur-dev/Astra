import Cocoa
import os.log

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusBarController: StatusBarController?
    private let logger = OSLog(subsystem: "com.voicehotkey.app", category: "AppDelegate")
    
    func applicationDidFinishLaunching(_ aNotification: Notification) {
        // Check for headless smoke test mode
        if ProcessInfo.processInfo.environment["VOICEHOTKEY_SMOKE_TEST"] == "1" {
            runSmokeTest()
            return
        }
        
        // Check for CLI smoke test flag
        if CommandLine.arguments.contains("--smoke-test") {
            runSmokeTest()
            return
        }
        
        // Normal GUI mode
        os_log("AppDelegate: Starting normal GUI mode", log: logger, type: .info)
        statusBarController = StatusBarController()
        
        // Check permissions on launch
        PermissionManager.shared.checkAllPermissions()
    }
    
    private func runSmokeTest() {
        os_log("AppDelegate: Running in smoke test mode", log: logger, type: .info)
        print("AppDelegate: Running in smoke test mode")
        
        // Initialize minimal startup path
        do {
            // Test StatusBarController initialization
            let testController = StatusBarController(smokeTestMode: true)
            
            // If we got here, initialization succeeded
            os_log("AppDelegate: Smoke test PASSED", log: logger, type: .info)
            print("AppDelegate: Smoke test PASSED")
            
            // Exit successfully
            exit(0)
        } catch {
            os_log("AppDelegate: Smoke test FAILED: %{public}@", log: logger, type: .error, error.localizedDescription)
            print("AppDelegate: Smoke test FAILED: \(error.localizedDescription)")
            exit(1)
        }
    }
    
    func applicationWillTerminate(_ aNotification: Notification) {
        // Cleanup
        statusBarController?.cleanup()
    }
    
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        return true
    }
}
