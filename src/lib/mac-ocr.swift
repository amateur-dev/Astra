import Cocoa
import Vision

let arguments = CommandLine.arguments
if arguments.count < 2 {
    print("Error: Please provide an image path")
    exit(1)
}

let imagePath = arguments[1]
guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("Error: Could not load image")
    exit(1)
}

let request = VNRecognizeTextRequest { request, error in
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    let recognizedText = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
    print(recognizedText)
}
// Fast recognition level is usually good enough for screen text and is extremely fast,
// but accurate is better for tricky fonts. We'll stick to accurate since it's still < 1s on Apple Silicon.
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])
