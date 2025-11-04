import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    var statusBarController: StatusBarController?
    
    func applicationDidFinishLaunching(_ aNotification: Notification) {
        statusBarController = StatusBarController()
        
        // Check permissions on launch
        PermissionManager.shared.checkAllPermissions()
    }
    
    func applicationWillTerminate(_ aNotification: Notification) {
        // Cleanup
        statusBarController?.cleanup()
    }
    
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        return true
    }
}
