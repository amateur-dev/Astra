import Cocoa
import AVFoundation

class PermissionManager {
    static let shared = PermissionManager()
    
    private init() {}
    
    // Check if app has accessibility permissions
    func checkAccessibilityPermission() -> Bool {
        let options: NSDictionary = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true]
        return AXIsProcessTrustedWithOptions(options)
    }
    
    // Request microphone permission
    func requestMicrophonePermission(completion: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async {
                completion(granted)
            }
        }
    }
    
    // Check microphone permission status
    func checkMicrophonePermission() -> Bool {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        return status == .authorized
    }
    
    // Check all permissions and show alerts if needed
    func checkAllPermissions() {
        // Check accessibility
        if !checkAccessibilityPermission() {
            showAlert(title: "Accessibility Permission Required",
                     message: "Please grant accessibility permissions in System Preferences > Security & Privacy > Privacy > Accessibility to enable global hotkeys.")
        }
        
        // Check microphone
        if !checkMicrophonePermission() {
            requestMicrophonePermission { granted in
                if !granted {
                    self.showAlert(title: "Microphone Permission Required",
                                 message: "Please grant microphone access in System Preferences to use voice input.")
                }
            }
        }
    }
    
    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
