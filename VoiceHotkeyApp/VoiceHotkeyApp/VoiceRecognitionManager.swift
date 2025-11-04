import Foundation
import AVFoundation
import Speech
import Cocoa

enum RecognitionMode {
    case pushToTalk  // Press and hold
    case toggle      // Press once to start, press again to stop
}

class VoiceRecognitionManager: NSObject {
    static let shared = VoiceRecognitionManager()
    
    private var audioEngine: AVAudioEngine?
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    
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
        setupSpeechRecognizer()
    }
    
    private func setupSpeechRecognizer() {
        // Use on-device recognition
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        speechRecognizer?.defaultTaskHint = .dictation
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
        guard PermissionManager.shared.checkMicrophonePermission(),
              PermissionManager.shared.checkSpeechRecognitionPermission() else {
            print("Missing permissions for voice recognition")
            return
        }
        
        do {
            // Create and configure recognition request
            recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
            guard let recognitionRequest = recognitionRequest else {
                print("Unable to create recognition request")
                return
            }
            
            recognitionRequest.shouldReportPartialResults = true
            recognitionRequest.requiresOnDeviceRecognition = true
            
            // Create audio engine and input node
            audioEngine = AVAudioEngine()
            guard let audioEngine = audioEngine else {
                print("Unable to create audio engine")
                return
            }
            
            let inputNode = audioEngine.inputNode
            let recordingFormat = inputNode.outputFormat(forBus: 0)
            
            // Install tap on audio engine
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
                recognitionRequest.append(buffer)
            }
            
            // Start audio engine
            audioEngine.prepare()
            try audioEngine.start()
            
            // Start recognition task
            recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest) { [weak self] result, error in
                guard let self = self else { return }
                
                if let result = result {
                    let transcription = result.bestTranscription.formattedString
                    
                    if result.isFinal {
                        self.onFinalResult?(transcription)
                        if self.recognitionMode == .pushToTalk {
                            self.stopRecording()
                        }
                    } else {
                        self.onPartialResult?(transcription)
                    }
                }
                
                if error != nil {
                    self.stopRecording()
                }
            }
            
            isRecording = true
            recordingStartTime = Date()
            onRecognitionStart?()
            
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
        
        // Cancel recognition request
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        
        recognitionRequest = nil
        recognitionTask = nil
        audioEngine = nil
        
        isRecording = false
        recordingStartTime = nil
        onRecognitionStop?()
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
