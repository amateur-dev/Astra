import Foundation
import AVFoundation

class WhisperManager {
    static let shared = WhisperManager()
    
    private let ollamaBaseURL = "http://localhost:11434"
    private let modelName = "whisper"
    
    private var isOllamaAvailable = false
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
    
    // Check if Ollama with Whisper is available
    func checkWhisperAvailability() {
        guard let url = URL(string: "\(ollamaBaseURL)/api/tags") else {
            isOllamaAvailable = false
            return
        }
        
        var request = URLRequest(url: url)
        request.timeoutInterval = 2.0
        
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            
            if error == nil, let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                self.isOllamaAvailable = true
                
                // Check if Whisper model is available
                if let data = data,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let models = json["models"] as? [[String: Any]] {
                    self.isModelDownloaded = models.contains { model in
                        if let name = model["name"] as? String {
                            return name.contains(self.modelName) || name.contains("whisper")
                        }
                        return false
                    }
                }
            } else {
                self.isOllamaAvailable = false
            }
        }.resume()
    }
    
    // Download Whisper model
    func downloadModel(completion: @escaping (Bool, String) -> Void) {
        guard isOllamaAvailable else {
            completion(false, "Ollama is not running. Please install and start Ollama first.")
            return
        }
        
        guard !isModelDownloaded else {
            completion(true, "Whisper model already downloaded")
            return
        }
        
        guard let url = URL(string: "\(ollamaBaseURL)/api/pull") else {
            completion(false, "Invalid URL")
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = ["name": modelName]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            
            if let error = error {
                completion(false, "Download failed: \(error.localizedDescription)")
                return
            }
            
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                self.isModelDownloaded = true
                completion(true, "Whisper model downloaded successfully")
            } else {
                completion(false, "Download failed with unexpected response")
            }
        }
        
        task.resume()
    }
    
    // Transcribe audio file
    func transcribeAudio(fileURL: URL, completion: @escaping (Result<String, Error>) -> Void) {
        guard isOllamaAvailable else {
            completion(.failure(NSError(domain: "WhisperManager", code: 1, 
                userInfo: [NSLocalizedDescriptionKey: "Ollama is not available"])))
            return
        }
        
        guard isModelDownloaded else {
            completion(.failure(NSError(domain: "WhisperManager", code: 2, 
                userInfo: [NSLocalizedDescriptionKey: "Whisper model not downloaded"])))
            return
        }
        
        onTranscriptionStart?()
        
        // Read audio file as base64
        guard let audioData = try? Data(contentsOf: fileURL) else {
            completion(.failure(NSError(domain: "WhisperManager", code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Failed to read audio file"])))
            return
        }
        
        let base64Audio = audioData.base64EncodedString()
        
        guard let url = URL(string: "\(ollamaBaseURL)/api/generate") else {
            completion(.failure(NSError(domain: "WhisperManager", code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 60.0
        
        let body: [String: Any] = [
            "model": modelName,
            "prompt": "Transcribe this audio:",
            "images": [base64Audio],
            "stream": false
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            
            if let error = error {
                DispatchQueue.main.async {
                    self.onTranscriptionError?("Transcription failed: \(error.localizedDescription)")
                    completion(.failure(error))
                }
                return
            }
            
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let response = json["response"] as? String else {
                DispatchQueue.main.async {
                    let error = NSError(domain: "WhisperManager", code: 5,
                        userInfo: [NSLocalizedDescriptionKey: "Invalid response from Whisper"])
                    self.onTranscriptionError?("Invalid response from Whisper")
                    completion(.failure(error))
                }
                return
            }
            
            let transcription = response.trimmingCharacters(in: .whitespacesAndNewlines)
            
            DispatchQueue.main.async {
                self.onTranscriptionComplete?(transcription)
                completion(.success(transcription))
            }
        }.resume()
    }
    
    func getStatus() -> (available: Bool, modelDownloaded: Bool) {
        return (isOllamaAvailable, isModelDownloaded)
    }
}
