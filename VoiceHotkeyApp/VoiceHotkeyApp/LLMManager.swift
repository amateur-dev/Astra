import Foundation

enum LLMProcessingType {
    case format          // Format text for better readability
    case grammarCorrect  // Correct grammar and spelling
    case smartEdit       // Improve writing style and clarity
}

class LLMManager {
    static let shared = LLMManager()
    
    private let ollamaBaseURL = "http://localhost:11434"
    private let modelName = "llama3"
    
    private var isOllamaAvailable = false
    private var isModelDownloaded = false
    
    // Callbacks
    var onProcessingStart: (() -> Void)?
    var onProcessingComplete: ((String) -> Void)?
    var onProcessingError: ((String) -> Void)?
    
    private init() {
        checkOllamaAvailability()
    }
    
    // Check if Ollama is installed and running
    func checkOllamaAvailability() {
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
                
                // Check if model is downloaded
                if let data = data,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let models = json["models"] as? [[String: Any]] {
                    self.isModelDownloaded = models.contains { model in
                        if let name = model["name"] as? String {
                            return name.contains(self.modelName)
                        }
                        return false
                    }
                }
            } else {
                self.isOllamaAvailable = false
            }
        }.resume()
    }
    
    // Download the model if not present
    func downloadModel(completion: @escaping (Bool, String) -> Void) {
        guard isOllamaAvailable else {
            completion(false, "Ollama is not running. Please install and start Ollama first.")
            return
        }
        
        guard !isModelDownloaded else {
            completion(true, "Model already downloaded")
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
                completion(true, "Model downloaded successfully")
            } else {
                completion(false, "Download failed with unexpected response")
            }
        }
        
        task.resume()
    }
    
    // Process text with LLM
    func processText(_ text: String, type: LLMProcessingType, completion: @escaping (Result<String, Error>) -> Void) {
        guard isOllamaAvailable else {
            completion(.failure(NSError(domain: "LLMManager", code: 1, userInfo: [NSLocalizedDescriptionKey: "Ollama is not available"])))
            return
        }
        
        guard isModelDownloaded else {
            completion(.failure(NSError(domain: "LLMManager", code: 2, userInfo: [NSLocalizedDescriptionKey: "Model not downloaded"])))
            return
        }
        
        onProcessingStart?()
        
        let prompt = buildPrompt(for: type, text: text)
        
        guard let url = URL(string: "\(ollamaBaseURL)/api/generate") else {
            completion(.failure(NSError(domain: "LLMManager", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30.0
        
        let body: [String: Any] = [
            "model": modelName,
            "prompt": prompt,
            "stream": false
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            
            if let error = error {
                DispatchQueue.main.async {
                    self.onProcessingError?("Processing failed: \(error.localizedDescription)")
                    completion(.failure(error))
                }
                return
            }
            
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let response = json["response"] as? String else {
                DispatchQueue.main.async {
                    let error = NSError(domain: "LLMManager", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
                    self.onProcessingError?("Invalid response from LLM")
                    completion(.failure(error))
                }
                return
            }
            
            let processedText = response.trimmingCharacters(in: .whitespacesAndNewlines)
            
            DispatchQueue.main.async {
                self.onProcessingComplete?(processedText)
                completion(.success(processedText))
            }
        }.resume()
    }
    
    private func buildPrompt(for type: LLMProcessingType, text: String) -> String {
        switch type {
        case .format:
            return """
            Format the following text for better readability. Fix capitalization, add punctuation, and structure it properly. Only return the formatted text without any explanations.
            
            Text: \(text)
            """
        case .grammarCorrect:
            return """
            Correct all grammar and spelling errors in the following text. Only return the corrected text without any explanations or notes about what was changed.
            
            Text: \(text)
            """
        case .smartEdit:
            return """
            Improve the following text by making it clearer, more concise, and better written while preserving the original meaning. Only return the improved text without any explanations.
            
            Text: \(text)
            """
        }
    }
    
    func getStatus() -> (available: Bool, modelDownloaded: Bool) {
        return (isOllamaAvailable, isModelDownloaded)
    }
}
