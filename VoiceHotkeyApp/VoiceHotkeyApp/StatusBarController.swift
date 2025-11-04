import Cocoa
import os.log

class StatusBarController {
    private var statusItem: NSStatusItem?
    private var menu: NSMenu?
    private var preferencesWindow: PreferencesWindow?
    
    // Menu items that need to be updated
    private var modeMenuItem: NSMenuItem?
    private var statusMenuItem: NSMenuItem?
    private var llmStatusMenuItem: NSMenuItem?
    
    // Store last transcribed text for LLM processing
    private var lastTranscribedText: String = ""
    
    // Logger
    private let logger = OSLog(subsystem: "com.voicehotkey.app", category: "StatusBarController")
    
    // Smoke test mode flag
    private let isSmokeTest: Bool
    
    convenience init() {
        self.init(smokeTestMode: false)
    }
    
    init(smokeTestMode: Bool) {
        self.isSmokeTest = smokeTestMode
        
        os_log("StatusBarController initializing...", log: logger, type: .info)
        print("StatusBarController initializing...")
        
        setupStatusItem()
        
        if !isSmokeTest {
            // Only setup full app in non-smoke-test mode
            setupMenu()
            setupVoiceRecognition()
            registerHotkey()
        }
        
        os_log("StatusBarController initialized", log: logger, type: .info)
        print("StatusBarController initialized")
    }
    
    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem?.button {
            // Try to create the image
            if let image = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: "Voice Hotkey") {
                button.image = image
                button.image?.isTemplate = true
                os_log("Status bar icon set successfully", log: logger, type: .info)
                print("Status bar icon set successfully")
            } else {
                os_log("Failed to create mic.fill icon, trying fallback", log: logger, type: .error)
                print("Failed to create mic.fill icon, trying fallback")
                // Fallback to a text-based icon
                button.title = "🎙️"
            }
        } else {
            os_log("Failed to get status item button", log: logger, type: .error)
            print("Failed to get status item button")
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
        
        // System status
        llmStatusMenuItem = NSMenuItem(title: "System: Checking...", action: nil, keyEquivalent: "")
        llmStatusMenuItem?.isEnabled = false
        menu?.addItem(llmStatusMenuItem!)
        
        menu?.addItem(NSMenuItem.separator())
        
        // Setup menu item
        let setupItem = NSMenuItem(title: "Setup Models (Whisper + LLM)", action: #selector(setupModels), keyEquivalent: "")
        setupItem.target = self
        menu?.addItem(setupItem)
        
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
            self?.updateStatus("Transcribing with Whisper...")
        }
        
        voiceManager.onFinalResult = { [weak self] text in
            print("Final polished text: \(text)")
            self?.updateStatus("Ready")
            self?.updateIcon(recording: false)
            self?.lastTranscribedText = text
            self?.insertText(text)
        }
        
        // Setup Whisper callbacks
        let whisperManager = WhisperManager.shared
        
        whisperManager.onTranscriptionStart = { [weak self] in
            self?.updateStatus("Transcribing with Whisper...")
        }
        
        whisperManager.onTranscriptionComplete = { [weak self] text in
            self?.updateStatus("Polishing with LLM...")
        }
        
        whisperManager.onTranscriptionError = { [weak self] error in
            self?.updateStatus("Transcription Error")
            self?.updateIcon(recording: false)
            self?.showAlert(title: "Transcription Error", message: error)
        }
        
        // Setup LLM callbacks
        let llmManager = LLMManager.shared
        
        llmManager.onProcessingStart = { [weak self] in
            self?.updateStatus("Polishing with LLM...")
        }
        
        llmManager.onProcessingError = { [weak self] error in
            self?.updateStatus("LLM Error")
        }
        
        // Check system status
        updateSystemStatus()
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
    
    // MARK: - Setup Methods
    
    @objc private func setupModels() {
        let whisperStatus = WhisperManager.shared.getStatus()
        let llmStatus = LLMManager.shared.getStatus()
        
        if !whisperStatus.available || !llmStatus.available {
            showAlert(title: "Install Ollama", 
                     message: "Please install Ollama from https://ollama.ai\n\nAfter installation:\n1. Start Ollama\n2. Return to this menu and select 'Setup Models' again")
            return
        }
        
        if whisperStatus.modelDownloaded && llmStatus.modelDownloaded {
            showAlert(title: "Models Ready", message: "Whisper and Llama 3 are already downloaded and ready to use!")
            return
        }
        
        // Download models sequentially
        if !whisperStatus.modelDownloaded {
            updateStatus("Downloading Whisper model...")
            
            WhisperManager.shared.downloadModel { [weak self] success, message in
                DispatchQueue.main.async {
                    if success {
                        // Now download LLM if needed
                        if !llmStatus.modelDownloaded {
                            self?.downloadLLMModel()
                        } else {
                            self?.updateStatus("Ready")
                            self?.updateSystemStatus()
                            self?.showAlert(title: "Success", message: "Whisper model downloaded successfully!")
                        }
                    } else {
                        self?.updateStatus("Ready")
                        self?.showAlert(title: "Error", message: message)
                    }
                }
            }
        } else if !llmStatus.modelDownloaded {
            downloadLLMModel()
        }
    }
    
    private func downloadLLMModel() {
        updateStatus("Downloading Llama 3...")
        
        LLMManager.shared.downloadModel { [weak self] success, message in
            DispatchQueue.main.async {
                self?.updateStatus("Ready")
                self?.updateSystemStatus()
                self?.showAlert(title: success ? "Success" : "Error", message: message)
            }
        }
    }
    
    private func updateSystemStatus() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            let whisperStatus = WhisperManager.shared.getStatus()
            let llmStatus = LLMManager.shared.getStatus()
            
            let statusText: String
            if whisperStatus.available && whisperStatus.modelDownloaded && 
               llmStatus.available && llmStatus.modelDownloaded {
                statusText = "System: Ready (Whisper + Llama 3)"
            } else if whisperStatus.available && llmStatus.available {
                if !whisperStatus.modelDownloaded && !llmStatus.modelDownloaded {
                    statusText = "System: Models not downloaded"
                } else if !whisperStatus.modelDownloaded {
                    statusText = "System: Whisper not downloaded"
                } else {
                    statusText = "System: LLM not downloaded"
                }
            } else {
                statusText = "System: Ollama not available"
            }
            
            self?.llmStatusMenuItem?.title = statusText
        }
    }
    
    private func showAlert(title: String, message: String) {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = title
            alert.informativeText = message
            alert.alertStyle = .informational
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }
}
