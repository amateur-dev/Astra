import Foundation
import AVFoundation

class WhisperManager {
    static let shared = WhisperManager()

    private let whisperDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!.appendingPathComponent("VoiceHotkeyApp/Whisper")
    private let whisperBinaryURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!.appendingPathComponent("VoiceHotkeyApp/Whisper/main")
    private let modelURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!.appendingPathComponent("VoiceHotkeyApp/Whisper/ggml-base.bin")

    private var isWhisperAvailable = false
    private var isModelDownloaded = false

    // Audio buffer for recording
    private var audioBuffer: AVAudioPCMBuffer?
    private var audioFile: AVAudioFile?
    private var tempAudioURL: URL?

    // Callbacks
    var onTranscriptionStart: (() -> Void)?
    var onTranscriptionComplete: ((String) -> Void)?
    var onTranscriptionError: ((String) -> Void)?

    private init() {
        checkWhisperAvailability()
    }
    
    // Check if whisper.cpp is available locally
    func checkWhisperAvailability() {
        let fileManager = FileManager.default

        // Check if whisper directory exists
        if !fileManager.fileExists(atPath: whisperDir.path) {
            try? fileManager.createDirectory(at: whisperDir, withIntermediateDirectories: true)
        }

        // Check if binary exists and is executable
        isWhisperAvailable = fileManager.fileExists(atPath: whisperBinaryURL.path) &&
                            fileManager.isExecutableFile(atPath: whisperBinaryURL.path)

        // Check if model exists
        isModelDownloaded = fileManager.fileExists(atPath: modelURL.path)
    }
    
    // Download whisper.cpp binary and model
    func downloadModel(completion: @escaping (Bool, String) -> Void) {
        let dispatchGroup = DispatchGroup()

        var binarySuccess = false
        var modelSuccess = false
        var errors: [String] = []

        // Download binary first
        dispatchGroup.enter()
        downloadWhisperBinary { success, message in
            binarySuccess = success
            if !success {
                errors.append("Binary: \(message)")
            }
            dispatchGroup.leave()
        }

        // Download model
        dispatchGroup.enter()
        downloadWhisperModel { success, message in
            modelSuccess = success
            if !success {
                errors.append("Model: \(message)")
            }
            dispatchGroup.leave()
        }

        dispatchGroup.notify(queue: .main) {
            let overallSuccess = binarySuccess && modelSuccess
            let message = overallSuccess ? "Whisper downloaded successfully" : "Download failed: \(errors.joined(separator: "; "))"
            completion(overallSuccess, message)
        }
    }

    private func downloadWhisperBinary(completion: @escaping (Bool, String) -> Void) {
        guard !isWhisperAvailable else {
            completion(true, "Binary already downloaded")
            return
        }

        // Download pre-compiled whisper.cpp binary for macOS ARM64
        let binaryURL = URL(string: "https://github.com/ggerganov/whisper.cpp/releases/download/v1.5.4/whisper-bin-arm64.tar.gz")!

        let tarGzPath = whisperDir.appendingPathComponent("whisper-bin-arm64.tar.gz")
        downloadFile(from: binaryURL, to: tarGzPath) { success, _ in
            guard success else {
                completion(false, "Failed to download binary")
                return
            }

            // Extract tar.gz using tar command
            let extractProcess = Process()
            extractProcess.executableURL = URL(fileURLWithPath: "/usr/bin/tar")
            extractProcess.arguments = ["-xzf", tarGzPath.path, "-C", self.whisperDir.path]
            extractProcess.currentDirectoryURL = self.whisperDir

            do {
                try extractProcess.run()
                extractProcess.waitUntilExit()

                if extractProcess.terminationStatus == 0 {
                    // Move the extracted binary to the expected location
                    let extractedBinaryPath = self.whisperDir.appendingPathComponent("main")
                    if FileManager.default.fileExists(atPath: extractedBinaryPath.path) {
                        try FileManager.default.moveItem(at: extractedBinaryPath, to: self.whisperBinaryURL)
                        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: self.whisperBinaryURL.path)
                        self.isWhisperAvailable = true
                        completion(true, "Binary downloaded and extracted")
                    } else {
                        completion(false, "Extracted binary not found at expected location")
                    }
                } else {
                    completion(false, "Failed to extract tar.gz")
                }

                // Clean up tar.gz file
                try? FileManager.default.removeItem(at: tarGzPath)

            } catch {
                completion(false, "Failed to extract binary: \(error.localizedDescription)")
            }
        }
    }

    private func downloadWhisperModel(completion: @escaping (Bool, String) -> Void) {
        guard !isModelDownloaded else {
            completion(true, "Model already downloaded")
            return
        }

        // Download base Whisper model
        let modelDownloadURL = URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin")!

        downloadFile(from: modelDownloadURL, to: modelURL) { success, _ in
            if success {
                self.isModelDownloaded = true
                completion(true, "Model downloaded successfully")
            } else {
                completion(false, "Failed to download model")
            }
        }
    }

    private func downloadFile(from url: URL, to destination: URL, completion: @escaping (Bool, URL?) -> Void) {
        let task = URLSession.shared.downloadTask(with: url) { tempURL, response, error in
            guard let tempURL = tempURL, error == nil else {
                completion(false, nil)
                return
            }

            do {
                let fileManager = FileManager.default
                if fileManager.fileExists(atPath: destination.path) {
                    try fileManager.removeItem(at: destination)
                }
                try fileManager.moveItem(at: tempURL, to: destination)
                completion(true, destination)
            } catch {
                completion(false, nil)
            }
        }
        task.resume()
    }
    
    // Transcribe audio file using whisper.cpp
    func transcribeAudio(fileURL: URL, completion: @escaping (Result<String, Error>) -> Void) {
        guard isWhisperAvailable else {
            completion(.failure(NSError(domain: "WhisperManager", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Whisper binary not available"])))
            return
        }

        guard isModelDownloaded else {
            completion(.failure(NSError(domain: "WhisperManager", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Whisper model not downloaded"])))
            return
        }

        onTranscriptionStart?()

        // Run whisper.cpp as a subprocess
        let process = Process()
        process.executableURL = whisperBinaryURL
        process.arguments = [
            "-m", modelURL.path,           // model path
            "-f", fileURL.path,            // audio file path
            "--language", "en",            // language (can be made configurable)
            "--output-txt",                // output as text
            "--no-timestamps"              // don't include timestamps
        ]

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        do {
            try process.run()
            process.waitUntilExit()

            let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
            let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()

            if process.terminationStatus == 0 {
                // Success
                if let transcription = String(data: outputData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
                    DispatchQueue.main.async {
                        self.onTranscriptionComplete?(transcription)
                        completion(.success(transcription))
                    }
                } else {
                    DispatchQueue.main.async {
                        let error = NSError(domain: "WhisperManager", code: 5,
                            userInfo: [NSLocalizedDescriptionKey: "Failed to parse transcription output"])
                        self.onTranscriptionError?("Failed to parse transcription")
                        completion(.failure(error))
                    }
                }
            } else {
                // Error
                let errorMessage = String(data: errorData, encoding: .utf8) ?? "Unknown error"
                DispatchQueue.main.async {
                    self.onTranscriptionError?("Whisper failed: \(errorMessage)")
                    let error = NSError(domain: "WhisperManager", code: 6,
                        userInfo: [NSLocalizedDescriptionKey: errorMessage])
                    completion(.failure(error))
                }
            }
        } catch {
            DispatchQueue.main.async {
                self.onTranscriptionError?("Failed to run Whisper: \(error.localizedDescription)")
                completion(.failure(error))
            }
        }
    }
    
    func getStatus() -> (available: Bool, modelDownloaded: Bool) {
        return (isWhisperAvailable, isModelDownloaded)
    }
}
