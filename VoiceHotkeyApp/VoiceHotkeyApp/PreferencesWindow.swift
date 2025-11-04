import Cocoa

class PreferencesWindow: NSObject {
    private var window: NSWindow?
    private var hotkeyLabel: NSTextField?
    
    func showWindow() {
        if window == nil {
            createWindow()
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    
    private func createWindow() {
        // Create window
        let windowRect = NSRect(x: 0, y: 0, width: 400, height: 300)
        window = NSWindow(contentRect: windowRect,
                         styleMask: [.titled, .closable, .miniaturizable],
                         backing: .buffered,
                         defer: false)
        window?.title = "Voice Hotkey Preferences"
        window?.center()
        
        // Create content view
        let contentView = NSView(frame: windowRect)
        window?.contentView = contentView
        
        // Title
        let titleLabel = NSTextField(labelWithString: "Voice Hotkey Settings")
        titleLabel.font = NSFont.boldSystemFont(ofSize: 16)
        titleLabel.frame = NSRect(x: 20, y: 240, width: 360, height: 30)
        contentView.addSubview(titleLabel)
        
        // Hotkey section
        let hotkeyTitleLabel = NSTextField(labelWithString: "Global Hotkey:")
        hotkeyTitleLabel.frame = NSRect(x: 20, y: 200, width: 120, height: 20)
        contentView.addSubview(hotkeyTitleLabel)
        
        hotkeyLabel = NSTextField(labelWithString: getHotkeyString())
        hotkeyLabel?.frame = NSRect(x: 150, y: 200, width: 200, height: 20)
        hotkeyLabel?.isEditable = false
        hotkeyLabel?.isBordered = false
        hotkeyLabel?.backgroundColor = .clear
        contentView.addSubview(hotkeyLabel!)
        
        // Hotkey info
        let hotkeyInfo = NSTextField(wrappingLabelWithString: "Note: Hotkey rebinding will be available in a future update. Current hotkey: Cmd+Shift+V")
        hotkeyInfo.frame = NSRect(x: 20, y: 150, width: 360, height: 40)
        hotkeyInfo.font = NSFont.systemFont(ofSize: 11)
        hotkeyInfo.textColor = .secondaryLabelColor
        contentView.addSubview(hotkeyInfo)
        
        // Mode section
        let modeTitleLabel = NSTextField(labelWithString: "Recognition Mode:")
        modeTitleLabel.frame = NSRect(x: 20, y: 110, width: 360, height: 20)
        contentView.addSubview(modeTitleLabel)
        
        // Push-to-Talk description
        let pushToTalkLabel = NSTextField(wrappingLabelWithString: "• Push-to-Talk: Press hotkey to start recording, automatically stops after speech")
        pushToTalkLabel.frame = NSRect(x: 20, y: 80, width: 360, height: 30)
        pushToTalkLabel.font = NSFont.systemFont(ofSize: 11)
        contentView.addSubview(pushToTalkLabel)
        
        // Toggle description
        let toggleLabel = NSTextField(wrappingLabelWithString: "• Toggle: Press hotkey once to start, press again to stop recording")
        toggleLabel.frame = NSRect(x: 20, y: 50, width: 360, height: 30)
        toggleLabel.font = NSFont.systemFont(ofSize: 11)
        contentView.addSubview(toggleLabel)
        
        // Permissions section
        let permissionsLabel = NSTextField(labelWithString: "Required Permissions:")
        permissionsLabel.frame = NSRect(x: 20, y: 10, width: 360, height: 20)
        contentView.addSubview(permissionsLabel)
        
        let permissionsInfo = NSTextField(wrappingLabelWithString: "• Accessibility (for global hotkeys)\n• Microphone (for voice input)\n• Speech Recognition (for voice-to-text)")
        permissionsInfo.frame = NSRect(x: 20, y: -40, width: 360, height: 50)
        permissionsInfo.font = NSFont.systemFont(ofSize: 11)
        permissionsInfo.textColor = .secondaryLabelColor
        contentView.addSubview(permissionsInfo)
    }
    
    private func getHotkeyString() -> String {
        let modifiers = HotkeyManager.shared.getModifierString()
        return "\(modifiers)V"
    }
}
