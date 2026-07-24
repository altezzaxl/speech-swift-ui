import Foundation

public struct StudioEnhancer {
    public init() {}

    public func process(_ input: [Float], sampleRate: Int) -> [Float] {
        guard !input.isEmpty else { return input }
        var audio = input
        audio = biquad(audio, sampleRate: sampleRate, frequency: 80, q: 0.707, type: .highPass)
        audio = biquad(audio, sampleRate: sampleRate, frequency: 280, q: 0.8, gainDB: -1.5, type: .peak)
        audio = biquad(audio, sampleRate: sampleRate, frequency: 3200, q: 0.7, gainDB: 1.4, type: .peak)
        audio = deEss(audio, sampleRate: sampleRate)
        audio = compress(audio, sampleRate: sampleRate)
        audio = saturate(audio, drive: 1.08, mix: 0.12)
        audio = roomReverb(audio, sampleRate: sampleRate, wet: 0.075)
        audio = normalize(audio, targetRMS: powf(10, -18.0 / 20.0), maxGainDB: 5)
        return limit(audio, ceiling: powf(10, -1.0 / 20.0))
    }

    private enum FilterType { case highPass, peak }
    private struct Biquad { var b0: Float; var b1: Float; var b2: Float; var a1: Float; var a2: Float }

    private func biquad(_ input: [Float], sampleRate: Int, frequency: Float, q: Float, gainDB: Float = 0, type: FilterType) -> [Float] {
        let w0 = 2 * Float.pi * frequency / Float(sampleRate)
        let cosW = cosf(w0), sinW = sinf(w0), alpha = sinW / (2 * q)
        let A = powf(10, gainDB / 40)
        let raw: (Float, Float, Float, Float, Float, Float)
        switch type {
        case .highPass:
            raw = ((1 + cosW) / 2, -(1 + cosW), (1 + cosW) / 2, 1 + alpha, -2 * cosW, 1 - alpha)
        case .peak:
            raw = (1 + alpha * A, -2 * cosW, 1 - alpha * A, 1 + alpha / A, -2 * cosW, 1 - alpha / A)
        }
        let b = Biquad(b0: raw.0 / raw.3, b1: raw.1 / raw.3, b2: raw.2 / raw.3, a1: raw.4 / raw.3, a2: raw.5 / raw.3)
        var output = [Float](repeating: 0, count: input.count)
        var x1: Float = 0, x2: Float = 0, y1: Float = 0, y2: Float = 0
        for index in input.indices {
            let x = input[index]
            let y = b.b0 * x + b.b1 * x1 + b.b2 * x2 - b.a1 * y1 - b.a2 * y2
            output[index] = y
            x2 = x1; x1 = x; y2 = y1; y1 = y
        }
        return output
    }

    private func deEss(_ input: [Float], sampleRate: Int) -> [Float] {
        let high = biquad(input, sampleRate: sampleRate, frequency: 5600, q: 0.7, type: .highPass)
        var output = input
        var envelope: Float = 0
        for index in input.indices {
            let level = abs(high[index])
            let coefficient: Float = level > envelope ? 0.18 : 0.025
            envelope += coefficient * (level - envelope)
            let reduction = envelope > 0.075 ? min(0.42, (envelope - 0.075) * 4.2) : 0
            output[index] -= high[index] * reduction
        }
        return output
    }

    private func compress(_ input: [Float], sampleRate: Int) -> [Float] {
        let threshold: Float = powf(10, -18 / 20)
        let attack = expf(-1 / (0.012 * Float(sampleRate)))
        let release = expf(-1 / (0.11 * Float(sampleRate)))
        let ratio: Float = 2.5
        var envelope: Float = 0
        var gain: Float = 1
        var output = input
        for index in input.indices {
            let level = abs(input[index])
            let coefficient = level > envelope ? attack : release
            envelope = coefficient * envelope + (1 - coefficient) * level
            let desired = envelope > threshold ? powf(envelope / threshold, 1 / ratio - 1) : 1
            let gainCoefficient = desired < gain ? attack : release
            gain = gainCoefficient * gain + (1 - gainCoefficient) * desired
            output[index] *= gain
        }
        return output
    }

    private func saturate(_ input: [Float], drive: Float, mix: Float) -> [Float] {
        input.map { value in
            let shaped = tanhf(value * drive) / tanhf(drive)
            return value * (1 - mix) + shaped * mix
        }
    }

    private func roomReverb(_ input: [Float], sampleRate: Int, wet: Float) -> [Float] {
        let delays = [1733, 1999, 2267, 2539].map { max(1, Int(Float($0) * Float(sampleRate) / 48000)) }
        var lines = delays.map { [Float](repeating: 0, count: $0) }
        var positions = [Int](repeating: 0, count: delays.count)
        var output = input
        for index in input.indices {
            let source = input[index]
            var reflection: Float = 0
            for lineIndex in lines.indices {
                let position = positions[lineIndex]
                let delayed = lines[lineIndex][position]
                lines[lineIndex][position] = source + delayed * 0.64
                positions[lineIndex] = (position + 1) % lines[lineIndex].count
                reflection += delayed
            }
            output[index] = source + reflection * wet / Float(lines.count)
        }
        return output
    }

    private func normalize(_ input: [Float], targetRMS: Float, maxGainDB: Float) -> [Float] {
        let rms = sqrtf(input.reduce(0) { $0 + $1 * $1 } / Float(input.count))
        guard rms > 0 else { return input }
        let gain = min(powf(10, maxGainDB / 20), targetRMS / rms)
        return input.map { $0 * gain }
    }

    private func limit(_ input: [Float], ceiling: Float) -> [Float] {
        let peak = input.reduce(Float.leastNonzeroMagnitude) { max($0, abs($1)) }
        guard peak > ceiling else { return input }
        let gain = ceiling / peak
        return input.map { $0 * gain }
    }
}
