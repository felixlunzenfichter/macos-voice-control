import SwiftUI
import CoreMotion
import AVFoundation
import Observation

struct ContentView: View {
    @State private var motionManager = MotionManager()
    @State private var googleBackend = GoogleBackend()
    @State private var audioManager = AudioManager()
    @State private var pingProgress: CGFloat = 1.0
    @State private var animationTimer: Timer?
    @State private var firstAudioPacketSent = false
    @State private var ttsEnabled = true
    @State private var ttsTogglePending = false
    @State private var ttsTargetState = true  // The state we're trying to reach
    @Environment(\.scenePhase) var scenePhase
    
    var body: some View {
        backgroundColorForState()
            .ignoresSafeArea()
            .overlay(
                VStack(spacing: 0) {
                    // Transcription view - always visible
                    VStack(spacing: 0) {
                        
                        // Scrollable transcription area with newest on top
                        ScrollView {
                            VStack(alignment: .leading, spacing: 10) {
                                // Show interim text at the top (newest) only when transcribing
                                if motionManager.isTranscribing && !googleBackend.interimText.isEmpty {
                                    Text(googleBackend.interimText)
                                        .font(.title3)
                                        .foregroundColor(.white.opacity(0.8))
                                        .multilineTextAlignment(.leading)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                
                                // Show all transcriptions below interim text
                                if !googleBackend.transcriptionText.isEmpty {
                                    // Split transcriptions by newlines and reverse to show newest first
                                    let lines = googleBackend.transcriptionText.split(separator: "\n").reversed()
                                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                                        Text(String(line))
                                            .font(.title3)
                                            .foregroundColor(.white)
                                            .multilineTextAlignment(.leading)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                }
                            }
                            .padding(20)
                        }
                        .frame(maxHeight: .infinity)
                        .scrollContentBackground(.hidden)
                        .background(backgroundColorForState())
                        
                        // Status bar above buttons - full width with equal spacing
                        HStack {
                            Spacer()
                            
                            // Backend status (our local server)
                            HStack(spacing: 5) {
                                Circle()
                                    .fill(googleBackend.serverStatuses["Backend"] == true ? Color.green : Color.gray.opacity(0.3))
                                    .frame(width: 10, height: 10)
                                    .scaleEffect(pingProgress)
                                    .animation(.linear(duration: 0.1), value: pingProgress)
                                Text("Backend")
                                    .font(.caption)
                                    .foregroundColor(.black)
                            }
                            
                            Spacer()
                            
                            // Mac server status
                            HStack(spacing: 5) {
                                Circle()
                                    .fill(googleBackend.serverStatuses["Mac Server"] == true ? Color.green : Color.gray.opacity(0.3))
                                    .frame(width: 10, height: 10)
                                    .scaleEffect(pingProgress)
                                    .animation(.linear(duration: 0.1), value: pingProgress)
                                Text("Mac")
                                    .font(.caption)
                                    .foregroundColor(.black)
                            }
                            
                            Spacer()
                        }
                        .padding(.vertical, 12)
                        .background(Color.white)
                        
                        // Buttons fill corners at bottom with white background
                        HStack(spacing: 2) {
                            // Help button - left corner (emergency recovery)
                            Button(action: {
                                Logger.shared.log("🆘 Help button pressed - Emergency recovery")
                                // Send emergency help message to recover voice control
                                googleBackend.sendHelpMessage()
                            }) {
                                Text("Help")
                                    .font(.title2)
                                    .bold()
                                    .frame(maxWidth: .infinity, maxHeight: 60)
                                    .background(Color.orange)
                                    .foregroundColor(.white)
                            }
                            
                            // TTS Toggle button - middle
                            Button(action: {
                                let targetState = !ttsEnabled
                                Logger.shared.log("🔊 TTS toggle requested: \(targetState)")
                                ttsTogglePending = true
                                ttsTargetState = targetState
                                // Don't toggle local state - wait for server response
                                googleBackend.sendTTSToggle(enabled: targetState)
                            }) {
                                Text(ttsTogglePending ? "TTS..." : (ttsEnabled ? "TTS On" : "TTS Off"))
                                    .font(.title2)
                                    .bold()
                                    .frame(maxWidth: .infinity, maxHeight: 60)
                                    .background(ttsTogglePending ? Color.yellow : (ttsEnabled ? Color.green : Color.red))
                                    .foregroundColor(.white)
                            }
                            
                            // Stop Claude Code button - right corner
                            Button(action: {
                                Logger.shared.log("⏹️ Stop Claude Code button pressed")
                                // Send escape key press message to server
                                googleBackend.sendEscapeKeyPress()
                            }) {
                                Text("Stop Claude")
                                    .font(.title2)
                                    .bold()
                                    .frame(maxWidth: .infinity, maxHeight: 60)
                                    .background(Color.blue)
                                    .foregroundColor(.white)
                            }
                        }
                        // Remove white background to show full screen color
                    }
                }
                .background(backgroundColorForState())
                .rotationEffect(Angle(degrees: 180))
            )
            .persistentSystemOverlays(.hidden)
            .preferredColorScheme(.light)
            .onAppear {
                Logger.shared.log("App started. Log file: \(Logger.shared.getLogFilePath())")
                audioManager.onAudioData = { data in
                    googleBackend.sendAudioData(data)
                }
                // Set the sample rate to 16000 Hz as that's what AudioManager converts to
                googleBackend.sampleRate = 16000
                Logger.shared.log("Set GoogleBackend sample rate to 16000 Hz")
                
                // Set up animation callback
                googleBackend.onStatusUpdate = { [self] in
                    // Reset to full size with animation
                    Logger.shared.log("🔄 Status update received, current progress: \(self.pingProgress)")
                    DispatchQueue.main.async {
                        withAnimation(.linear(duration: 0.1)) {
                            self.pingProgress = 1.0
                        }
                        Logger.shared.log("✅ Animation reset to 1.0, new value: \(self.pingProgress)")
                    }
                }
                
                // Set up callback for first audio packet sent
                googleBackend.onFirstAudioPacketSent = { [self] in
                    DispatchQueue.main.async {
                        self.firstAudioPacketSent = true
                        Logger.shared.log("🟢 Background turning green - first audio packet sent successfully")
                    }
                }
                
                // Set up callback for TTS state changes
                googleBackend.onTTSStateChanged = { [self] enabled in
                    DispatchQueue.main.async {
                        self.ttsEnabled = enabled
                        self.ttsTogglePending = false
                        Logger.shared.log("✅ TTS state confirmed by server: \(enabled)")
                    }
                }
                
                // Connect to backend immediately for pinging
                googleBackend.connect()
                
                // Start animation timer
                startAnimationTimer()
            }
            .onChange(of: motionManager.isTranscribing) { isActive in
                DispatchQueue.main.async {
                    if isActive {
                        Logger.shared.log("📱 iPhone: Starting transcription mode")
                        audioManager.requestMicrophonePermission()
                        // Already connected to backend, just start recognition
                        if googleBackend.isConnected {
                            audioManager.startRecording()
                            googleBackend.startRecognition()
                        } else {
                            Logger.shared.log("❌ iPhone: Not connected to backend")
                        }
                    } else {
                        Logger.shared.log("📱 iPhone: Stopping transcription mode")
                        audioManager.stopRecording()
                        googleBackend.stopRecognition()
                        // Reset first packet sent flag
                        firstAudioPacketSent = false
                        Logger.shared.log("🔄 Reset firstAudioPacketSent to false")
                        // Stay connected to backend for pinging
                    }
                }
            }
            .onDisappear {
                animationTimer?.invalidate()
                animationTimer = nil
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
                Logger.shared.log("🔄 App entering foreground - reconnecting all services")
                
                // Disconnect everything first
                audioManager.stopRecording()
                googleBackend.stopRecognition()
                googleBackend.disconnect()
                
                // Reset states
                firstAudioPacketSent = false
                motionManager.resetTranscriptionState()
                
                // Wait a moment then reconnect
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    Logger.shared.log("🔄 Reconnecting to backend...")
                    googleBackend.connect()
                    
                    // Restart animation timer
                    startAnimationTimer()
                }
            }
            .onChange(of: scenePhase) { phase in
                if phase == .active {
                    Logger.shared.log("🔄 Scene became active - ensuring connection")
                    
                    // Check if we need to reconnect
                    if !googleBackend.isConnected {
                        Logger.shared.log("❌ Not connected - performing full reconnect")
                        
                        // Reset everything and reconnect
                        audioManager.stopRecording()
                        googleBackend.stopRecognition()
                        firstAudioPacketSent = false
                        motionManager.resetTranscriptionState()
                        
                        // Reconnect
                        googleBackend.connect()
                        startAnimationTimer()
                    } else {
                        Logger.shared.log("✅ Already connected - checking status")
                        // Just request a status update to ensure everything is working
                        googleBackend.requestServerStatus()
                    }
                } else if phase == .background {
                    Logger.shared.log("📱 App going to background")
                }
            }
    }
    
    func startAnimationTimer() {
        // Stop any existing timer
        animationTimer?.invalidate()
        
        Logger.shared.log("🎬 Starting animation timer, initial progress: \(pingProgress)")
        
        // Create new timer that decreases progress over 1 second
        animationTimer = Timer.scheduledTimer(withTimeInterval: 0.03, repeats: true) { _ in
            if pingProgress > 0 {
                let oldProgress = pingProgress
                let newProgress = max(0, pingProgress - 0.03)
                withAnimation(.linear(duration: 0.03)) {
                    pingProgress = newProgress
                }
                
                // Log every 10th update (approximately every 0.3 seconds)
                if Int(oldProgress * 100) % 10 == 0 {
                    Logger.shared.log("🔄 Animation progress: \(pingProgress)")
                }
                
                // Log when we hit zero
                if newProgress == 0 && oldProgress > 0 {
                    Logger.shared.log("⏰ Animation reached zero - waiting for ping response")
                }
            }
        }
    }
    
    func backgroundColorForState() -> Color {
        if firstAudioPacketSent && audioManager.isRecording {
            return Color.green
        } else if motionManager.isTranscribing && googleBackend.isConnected {
            return Color.yellow
        } else {
            return Color.red
        }
    }
}

@Observable
class MotionManager {
    private let motionManager = CMMotionManager()
    var pitch: Double = 0
    var roll: Double = 0
    var yaw: Double = 0
    var isTranscribing: Bool = false
    
    init() {
        startMotionUpdates()
    }
    
    private func startMotionUpdates() {
        guard motionManager.isDeviceMotionAvailable else { return }
        
        motionManager.deviceMotionUpdateInterval = 0.1
        motionManager.startDeviceMotionUpdates(to: .main) { [weak self] motion, error in
            guard let motion = motion else { return }
            
            self?.pitch = motion.attitude.pitch * 180 / .pi
            self?.roll = motion.attitude.roll * 180 / .pi
            self?.yaw = motion.attitude.yaw * 180 / .pi
            
            self?.isTranscribing = self?.pitch ?? 0 < -45
        }
    }
    
    func resetTranscriptionState() {
        isTranscribing = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            Logger.shared.log("📱 Transcription state reset - ready to detect tilt again")
        }
    }
    
    deinit {
        motionManager.stopDeviceMotionUpdates()
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}