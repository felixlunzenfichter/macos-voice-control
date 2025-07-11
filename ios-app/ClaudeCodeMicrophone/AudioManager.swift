import Foundation
import AVFoundation
import Observation

@Observable
class AudioManager: NSObject {
    private let audioEngine = AVAudioEngine()
    private let inputNode: AVAudioInputNode
    var onAudioData: ((Data) -> Void)?
    
    var isRecording = false
    
    override init() {
        self.inputNode = audioEngine.inputNode
        super.init()
    }
    
    func requestMicrophonePermission() {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            if granted {
                Logger.shared.log("Microphone permission granted")
            } else {
                Logger.shared.log("Microphone permission denied")
            }
        }
    }
    
    func startRecording() {
        guard !isRecording else { 
            Logger.shared.log("🔴 Already recording")
            return 
        }
        
        Logger.shared.log("🎤 Starting audio recording...")
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
            
            let recordingFormat = inputNode.outputFormat(forBus: 0)
            
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
                guard let self = self else { return }
                
                // Convert to 16kHz 16-bit PCM for Google Speech
                if let audioData = self.convertBufferTo16kHzPCM(buffer: buffer, inputFormat: recordingFormat) {
                    self.onAudioData?(audioData)
                }
            }
            
            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true
            Logger.shared.log("✅ Audio recording started successfully")
            
        } catch {
            Logger.shared.log("Failed to start recording: \(error)")
        }
    }
    
    func stopRecording() {
        guard isRecording else { return }
        
        audioEngine.stop()
        inputNode.removeTap(onBus: 0)
        isRecording = false
        
        do {
            try AVAudioSession.sharedInstance().setActive(false)
        } catch {
            Logger.shared.log("Failed to deactivate audio session: \(error)")
        }
    }
    
    private func convertBufferTo16kHzPCM(buffer: AVAudioPCMBuffer, inputFormat: AVAudioFormat) -> Data? {
        // Target format: 16kHz, mono, 16-bit PCM
        guard let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16,
                                              sampleRate: 16000,
                                              channels: 1,
                                              interleaved: true) else { return nil }
        
        guard let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else { return nil }
        
        let inputFrameCapacity = AVAudioFrameCount(outputFormat.sampleRate * Double(buffer.frameLength) / inputFormat.sampleRate)
        
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: inputFrameCapacity) else { return nil }
        
        var error: NSError?
        let status = converter.convert(to: outputBuffer, error: &error) { inNumPackets, outStatus in
            outStatus.pointee = .haveData
            return buffer
        }
        
        guard status != .error else {
            Logger.shared.log("Conversion error: \(error?.localizedDescription ?? "Unknown")")
            return nil
        }
        
        // Convert to Data
        let channelData = outputBuffer.int16ChannelData![0]
        let channelDataValueArray = stride(from: 0,
                                          to: Int(outputBuffer.frameLength),
                                          by: buffer.stride).map { channelData[$0] }
        
        return channelDataValueArray.withUnsafeBufferPointer { Data(buffer: $0) }
    }
}