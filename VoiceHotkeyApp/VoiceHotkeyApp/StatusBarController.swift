import Cocoa

class StatusBarController {
    private var statusItem: NSStatusItem?
    private var menu: NSMenu?
    private var preferencesWindow: PreferencesWindow?
    
    // Menu items that need to be updated
    private var modeMenuItem: NSMenuItem?
    private var statusMenuItem: NSMenuItem?
    
    init() {
        setupStatusItem()
        setupMenu()
        setupVoiceRecognition()
        registerHotkey()
    }
    
    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        
        if let button = statusItem?.button {
            button.image = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: "Voice Hotkey")
            button.image?.isTemplate = true
        }
    }
    
    private func setupMenu() {
        menu = NSMenu()
        
        // Status item
        statusMenuItem = NSMenuItem(title: "Ready", action: nil, keyEquivalent: "")
        statusMenuItem?.isEnabled = false
        menu?.addItem(statusMenuItem!)
        
        menu?.addItem(NSMenuItem.separator())
        
        // Mode selection
        modeMenuItem = NSMenuItem(title: "Mode: Push-to-Talk", action: #selector(toggleMode), keyEquivalent: "")
        modeMenuItem?.target = self
        menu?.addItem(modeMenuItem!)
        
        menu?.addItem(NSMenuItem.separator())
        
        // Preferences
        let preferencesItem = NSMenuItem(title: "Preferences...", action: #selector(openPreferences), keyEquivalent: ",")
        preferencesItem.target = self
        menu?.addItem(preferencesItem)
        
        // Check Permissions
        let permissionsItem = NSMenuItem(title: "Check Permissions", action: #selector(checkPermissions), keyEquivalent: "")
        permissionsItem.target = self
        menu?.addItem(permissionsItem)
        
        menu?.addItem(NSMenuItem.separator())
        
        // Quit
        let quitItem = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu?.addItem(quitItem)
        
        statusItem?.menu = menu
    }
    
    private func setupVoiceRecognition() {
        let voiceManager = VoiceRecognitionManager.shared
        
        voiceManager.onRecognitionStart = { [weak self] in
            self?.updateStatus("Recording...")
            self?.updateIcon(recording: true)
        }
        
        voiceManager.onRecognitionStop = { [weak self] in
            self?.updateStatus("Ready")
            self?.updateIcon(recording: false)
        }
        
        voiceManager.onPartialResult = { text in
            print("Partial: \(text)")
        }
        
        voiceManager.onFinalResult = { [weak self] text in
            print("Final: \(text)")
            self?.insertText(text)
        }
    }
    
    private func registerHotkey() {
        HotkeyManager.shared.registerHotkey { [weak self] in
            self?.handleHotkey()
        }
    }
    
    private func handleHotkey() {
        let voiceManager = VoiceRecognitionManager.shared
        let mode = voiceManager.getRecognitionMode()
        
        switch mode {
        case .pushToTalk:
            // Start recording on press
            if !voiceManager.isCurrentlyRecording() {
                voiceManager.startRecording()
                // Note: In a real implementation, we would need to detect key release
                // For now, we'll stop after a timeout or when speech ends
                DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) {
                    if voiceManager.isCurrentlyRecording() {
                        voiceManager.stopRecording()
                    }
                }
            }
        case .toggle:
            // Toggle recording
            voiceManager.toggleRecording()
        }
    }
    
    @objc private func toggleMode() {
        let voiceManager = VoiceRecognitionManager.shared
        let currentMode = voiceManager.getRecognitionMode()
        
        let newMode: RecognitionMode = currentMode == .pushToTalk ? .toggle : .pushToTalk
        voiceManager.setRecognitionMode(newMode)
        
        // Update menu item text
        let modeText = newMode == .pushToTalk ? "Push-to-Talk" : "Toggle"
        modeMenuItem?.title = "Mode: \(modeText)"
    }
    
    @objc private func openPreferences() {
        if preferencesWindow == nil {
            preferencesWindow = PreferencesWindow()
        }
        preferencesWindow?.showWindow()
    }
    
    @objc private func checkPermissions() {
        PermissionManager.shared.checkAllPermissions()
    }
    
    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
    
    private func updateStatus(_ status: String) {
        DispatchQueue.main.async { [weak self] in
            self?.statusMenuItem?.title = status
        }
    }
    
    private func updateIcon(recording: Bool) {
        DispatchQueue.main.async { [weak self] in
            if let button = self?.statusItem?.button {
                let iconName = recording ? "mic.fill" : "mic.fill"
                button.image = NSImage(systemSymbolName: iconName, accessibilityDescription: "Voice Hotkey")
                button.image?.isTemplate = true
                
                // Change appearance to indicate recording
                if recording {
                    button.appearsDisabled = false
                } else {
                    button.appearsDisabled = false
                }
            }
        }
    }
    
    private func insertText(_ text: String) {
        VoiceRecognitionManager.shared.insertText(text)
    }
    
    func cleanup() {
        HotkeyManager.shared.unregisterHotkey()
        VoiceRecognitionManager.shared.stopRecording()
    }
}
