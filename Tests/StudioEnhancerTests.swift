import XCTest
@testable import AudioCLILib

final class StudioEnhancerTests: XCTestCase {
    func testStudioChainPreservesLengthAndAvoidsClipping() {
        let input = (0..<48_000).map { index in
            Float(sin(Double(index) * 2 * .pi * 220 / 48_000)) * 0.2
        }
        let output = StudioEnhancer().process(input, sampleRate: 48_000)
        XCTAssertEqual(output.count, input.count)
        XCTAssertTrue(output.allSatisfy { abs($0) <= 0.8913 })
        XCTAssertGreaterThan(output.reduce(0) { $0 + $1 * $1 }, 0)
    }

    func testStudioChainHandlesSilence() {
        let output = StudioEnhancer().process([Float](repeating: 0, count: 1024), sampleRate: 48_000)
        XCTAssertEqual(output, [Float](repeating: 0, count: 1024))
    }
}
