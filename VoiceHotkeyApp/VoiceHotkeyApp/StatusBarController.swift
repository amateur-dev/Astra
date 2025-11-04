import Cocoa

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
        
        // LLM Processing submenu
        let llmMenu = NSMenu()
        
        llmStatusMenuItem = NSMenuItem(title: "LLM: Checking...", action: nil, keyEquivalent: "")
        llmStatusMenuItem?.isEnabled = false
        
        let formatItem = NSMenuItem(title: "Format Text", action: #selector(formatWithLLM), keyEquivalent: "f")
        formatItem.target = self
        formatItem.keyEquivalentModifierMask = [.command, .shift]
        
        let grammarItem = NSMenuItem(title: "Correct Grammar", action: #selector(correctGrammarWithLLM), keyEquivalent: "g")
        grammarItem.target = self
        grammarItem.keyEquivalentModifierMask = [.command, .shift]
        
        let smartEditItem = NSMenuItem(title: "Smart Edit", action: #selector(smartEditWithLLM), keyEquivalent: "e")
        smartEditItem.target = self
        smartEditItem.keyEquivalentModifierMask = [.command, .shift]
        
        let setupItem = NSMenuItem(title: "Setup LLM (Ollama)", action: #selector(setupLLM), keyEquivalent: "")
        setupItem.target = self
        
        llmMenu.addItem(llmStatusMenuItem!)
        llmMenu.addItem(NSMenuItem.separator())
        llmMenu.addItem(formatItem)
        llmMenu.addItem(grammarItem)
        llmMenu.addItem(smartEditItem)
        llmMenu.addItem(NSMenuItem.separator())
        llmMenu.addItem(setupItem)
        
        let llmMenuItem = NSMenuItem(title: "LLM Processing", action: nil, keyEquivalent: "")
        llmMenuItem.submenu = llmMenu
        menu?.addItem(llmMenuItem)
        
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
            self?.lastTranscribedText = text
            self?.insertText(text)
        }
        
        // Setup LLM callbacks
        let llmManager = LLMManager.shared
        
        llmManager.onProcessingStart = { [weak self] in
            self?.updateStatus("Processing with LLM...")
        }
        
        llmManager.onProcessingComplete = { [weak self] processedText in
            self?.updateStatus("Ready")
            self?.lastTranscribedText = processedText
            self?.insertText(processedText)
        }
        
        llmManager.onProcessingError = { [weak self] error in
            self?.updateStatus("LLM Error")
            self?.showAlert(title: "LLM Processing Error", message: error)
        }
        
        // Check LLM status
        updateLLMStatus()
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
    
    // MARK: - LLM Processing Methods
    
    @objc private func formatWithLLM() {
        processWithLLM(type: .format)
    }
    
    @objc private func correctGrammarWithLLM() {
        processWithLLM(type: .grammarCorrect)
    }
    
    @objc private func smartEditWithLLM() {
        processWithLLM(type: .smartEdit)
    }
    
    private func processWithLLM(type: LLMProcessingType) {
        guard !lastTranscribedText.isEmpty else {
            showAlert(title: "No Text Available", message: "Please transcribe some text first before using LLM processing.")
            return
        }
        
        let status = LLMManager.shared.getStatus()
        guard status.available else {
            showAlert(title: "Ollama Not Available", message: "Ollama is not installed or not running. Please install Ollama and start it, then use 'Setup LLM' from the menu.")
            return
        }
        
        guard status.modelDownloaded else {
            showAlert(title: "Model Not Downloaded", message: "Llama 3 model is not downloaded. Please use 'Setup LLM' from the menu to download it.")
            return
        }
        
        LLMManager.shared.processText(lastTranscribedText, type: type) { result in
            switch result {
            case .success(_):
                // Text is automatically inserted via callback
                break
            case .failure(let error):
                DispatchQueue.main.async { [weak self] in
                    self?.showAlert(title: "Processing Failed", message: error.localizedDescription)
                }
            }
        }
    }
    
    @objc private func setupLLM() {
        let status = LLMManager.shared.getStatus()
        
        if !status.available {
            showAlert(title: "Install Ollama", 
                     message: "Please install Ollama from https://ollama.ai\n\nAfter installation:\n1. Start Ollama\n2. Return to this menu and select 'Setup LLM' again")
            return
        }
        
        if status.modelDownloaded {
            showAlert(title: "LLM Ready", message: "Llama 3 is already downloaded and ready to use!")
            return
        }
        
        updateStatus("Downloading Llama 3...")
        
        LLMManager.shared.downloadModel { [weak self] success, message in
            DispatchQueue.main.async {
                self?.updateStatus("Ready")
                self?.updateLLMStatus()
                self?.showAlert(title: success ? "Success" : "Error", message: message)
            }
        }
    }
    
    private func updateLLMStatus() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            let status = LLMManager.shared.getStatus()
            
            let statusText: String
            if status.available && status.modelDownloaded {
                statusText = "LLM: Ready (Llama 3)"
            } else if status.available {
                statusText = "LLM: Available (Model not downloaded)"
            } else {
                statusText = "LLM: Not Available"
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
