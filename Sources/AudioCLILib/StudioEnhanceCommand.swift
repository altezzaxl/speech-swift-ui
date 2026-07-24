import Foundation
import ArgumentParser
import AudioCommon

public struct StudioEnhanceCommand: ParsableCommand {
    public static let configuration = CommandConfiguration(
        commandName: "studio-enhance",
        abstract: "Create a polished local studio version of speech audio"
    )

    @Argument(help: "Input audio file (WAV, any sample rate)")
    public var audioFile: String

    @Option(name: .shortAndLong, help: "Output WAV path (default: input_studio.wav)")
    public var output: String?

    public init() {}

    public func run() throws {
        let inputURL = URL(fileURLWithPath: audioFile)
        print("Loading audio for studio mastering: \(audioFile)")
        let audio = try AudioFileLoader.load(url: inputURL, targetSampleRate: 48000)
        print("  Loaded \(audio.count) samples (48kHz mono)")
        let start = Date()
        let enhanced = StudioEnhancer().process(audio, sampleRate: 48000)
        let outputPath = output ?? inputURL.deletingPathExtension().deletingLastPathComponent()
            .appendingPathComponent("\(inputURL.deletingPathExtension().lastPathComponent)_studio.wav").path
        try WAVWriter.write(samples: enhanced, sampleRate: 48000, to: URL(fileURLWithPath: outputPath))
        print(String(format: "  Studio chain finished in %.3fs", Date().timeIntervalSince(start)))
        print("  Saved: \(outputPath)")
    }
}
