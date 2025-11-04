import Foundation
import AVFoundation
import Cocoa

enum RecognitionMode {
    case pushToTalk  // Press and hold
    case toggle      // Press once to start, press again to stop
}

class VoiceRecognitionManager: NSObject {
    static let shared = VoiceRecognitionManager()
    
    private var audioEngine: AVAudioEngine?
    private var audioFile: AVAudioFile?
    private var tempAudioURL: URL?
    
    private var isRecording = false
    private var recognitionMode: RecognitionMode = .pushToTalk
    private var recordingStartTime: Date?
    
    // Callbacks
    var onRecognitionStart: (() -> Void)?
    var onRecognitionStop: (() -> Void)?
    var onPartialResult: ((String) -> Void)?
    var onFinalResult: ((String) -> Void)?
    
    private override init() {
        super.init()
    }
    
    func setRecognitionMode(_ mode: RecognitionMode) {
        recognitionMode = mode
    }
    
    func getRecognitionMode() -> RecognitionMode {
        return recognitionMode
    }
    
    // Start recording
    func startRecording() {
        guard !isRecording else { return }
        
        // Check permissions
        guard PermissionManager.shared.checkMicrophonePermission() else {
            print("Missing microphone permission")
            return
        }
        
        do {
            // Create temporary file for audio recording
            let tempDir = FileManager.default.temporaryDirectory
            tempAudioURL = tempDir.appendingPathComponent("voice_recording_\(UUID().uuidString).wav")
            
            guard let tempURL = tempAudioURL else {
                print("Unable to create temp file URL")
                return
            }
            
            // Create audio engine and input node
            audioEngine = AVAudioEngine()
            guard let audioEngine = audioEngine else {
                print("Unable to create audio engine")
                return
            }
            
            let inputNode = audioEngine.inputNode
            let recordingFormat = inputNode.outputFormat(forBus: 0)
            
            // Create audio file for recording
            audioFile = try AVAudioFile(forWriting: tempURL, 
                                       settings: recordingFormat.settings,
                                       commonFormat: .pcmFormatInt16,
                                       interleaved: true)
            
            // Install tap to write audio to file
            inputNode.installTap(onBus: 0, bufferSize: 4096, format: recordingFormat) { [weak self] buffer, _ in
                guard let self = self, let audioFile = self.audioFile else { return }
                do {
                    try audioFile.write(from: buffer)
                } catch {
                    print("Error writing audio buffer: \(error)")
                }
            }
            
            // Start audio engine
            audioEngine.prepare()
            try audioEngine.start()
            
            isRecording = true
            recordingStartTime = Date()
            onRecognitionStart?()
            
            // Auto-stop for push-to-talk mode
            if recognitionMode == .pushToTalk {
                DispatchQueue.main.asyncAfter(deadline: .now() + 10.0) { [weak self] in
                    if self?.isRecording == true {
                        self?.stopRecording()
                    }
                }
            }
            
        } catch {
            print("Error starting recording: \(error.localizedDescription)")
            stopRecording()
        }
    }
    
    // Stop recording
    func stopRecording() {
        guard isRecording else { return }
        
        // Stop audio engine
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        
        audioEngine = nil
        audioFile = nil
        
        isRecording = false
        recordingStartTime = nil
        onRecognitionStop?()
        
        // Process the recorded audio with Whisper and then LLM
        if let audioURL = tempAudioURL {
            processRecordedAudio(fileURL: audioURL)
        }
    }
    
    // Process recorded audio through Whisper → LLM pipeline
    private func processRecordedAudio(fileURL: URL) {
        // Step 1: Transcribe with Whisper
        WhisperManager.shared.transcribeAudio(fileURL: fileURL) { [weak self] result in
            guard let self = self else { return }
            
            switch result {
            case .success(let transcription):
                print("Whisper transcription: \(transcription)")
                
                // Step 2: Process with LLM for polishing
                self.processWithLLM(transcription)
                
            case .failure(let error):
                print("Transcription error: \(error.localizedDescription)")
                self.onFinalResult?("Error: \(error.localizedDescription)")
            }
            
            // Clean up temp file
            try? FileManager.default.removeItem(at: fileURL)
            self.tempAudioURL = nil
        }
    }
    
    // Process text with LLM for polishing
    private func processWithLLM(_ text: String) {
        LLMManager.shared.processText(text, type: .smartEdit) { [weak self] result in
            switch result {
            case .success(let polishedText):
                print("LLM polished: \(polishedText)")
                self?.onFinalResult?(polishedText)
                
            case .failure(let error):
                print("LLM error: \(error.localizedDescription)")
                // Fallback to original transcription if LLM fails
                self?.onFinalResult?(text)
            }
        }
    }
    
    // Toggle recording (for toggle mode)
    func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }
    
    func isCurrentlyRecording() -> Bool {
        return isRecording
    }
    
    // Insert text at cursor position using pasteboard and synthetic Cmd+V
    func insertText(_ text: String) {
        guard !text.isEmpty else { return }
        
        // Save current pasteboard contents
        let pasteboard = NSPasteboard.general
        let previousContents = pasteboard.string(forType: .string)
        
        // Set new text to pasteboard
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        
        // Small delay to ensure pasteboard is updated
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            // Send Cmd+V using CGEvent
            self.sendCommandV()
            
            // Restore previous pasteboard contents after a short delay
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                if let previousContents = previousContents {
                    pasteboard.clearContents()
                    pasteboard.setString(previousContents, forType: .string)
                }
            }
        }
    }
    
    private func sendCommandV() {
        // Create Cmd+V key down event
        let vKeyDown = CGEvent(keyboardEventSource: nil, virtualKey: 0x09, keyDown: true)
        vKeyDown?.flags = .maskCommand
        
        // Create Cmd+V key up event
        let vKeyUp = CGEvent(keyboardEventSource: nil, virtualKey: 0x09, keyDown: false)
        vKeyUp?.flags = .maskCommand
        
        // Post events
        vKeyDown?.post(tap: .cghidEventTap)
        vKeyUp?.post(tap: .cghidEventTap)
    }
}
