import Foundation
import AVFoundation

@Observable
class GoogleBackend: NSObject {
    // WebSocket connection
    private var webSocket: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    
    // Connection state
    var isConnected = false
    var isRecognizing = false
    var connectionStatus = "Disconnected"
    private var isIntentionalDisconnect = false
    
    // Server status tracking
    var serverStatuses: [String: Bool] = [
        "Backend": false,
        "Mac Server": false
    ]
    
    // Callback for status updates
    var onStatusUpdate: (() -> Void)?
    var onFirstAudioPacketSent: (() -> Void)?
    var onTTSStateChanged: ((Bool) -> Void)?
    
    // Audio configuration
    var sampleRate: Int?     // Set by AudioManager based on device hardware
    
    // Transcription results
    var transcriptionText = ""      // All finalized text
    var currentUtterance = ""       // Current utterance being spoken
    var interimText = ""           // Current interim text (not yet final)
    var latestFinalTranscript = ""  // Most recent final transcript
    var onTranscriptionComplete: ((String) -> Void)?  // Callback when transcription is final
    
    // Backend URL from configuration - REQUIRED
    private var backendURL: String {
        // Try to load from Config.plist
        if let path = Bundle.main.path(forResource: "Config", ofType: "plist"),
           let config = NSDictionary(contentsOfFile: path),
           let url = config["backendURL"] as? String {
            Logger.shared.log("Loaded backend URL from Config.plist: \(url)")
            return url
        }
        // FATAL: Config.plist is required
        let errorMessage = "FATAL ERROR: Config.plist not found in app bundle! The app cannot function without Config.plist containing backendURL."
        fatalError(errorMessage)
    }
    
    // Status check timer
    private var statusCheckTimer: Timer?
    
    // Track first audio packet
    private var firstPacketSent = false
    
    func connect() {
        // This will crash if Config.plist is missing
        let urlString = backendURL
        Logger.shared.log("Connecting to: \(urlString)")
        guard let url = URL(string: urlString) else {
            connectionStatus = "Invalid URL"
            return
        }
        
        isIntentionalDisconnect = false
        connectionStatus = "Connecting..."
        Logger.shared.log("WebSocket created, status: Connecting...")
        
        webSocket = session.webSocketTask(with: url)
        webSocket?.resume()
        
        // Start receiving messages
        receiveMessage()
        
        // Wait a moment for connection to establish
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self = self else { return }
            self.isConnected = true
            self.connectionStatus = "Connected"
            Logger.shared.log("Successfully connected to backend")
            
            // Send identify message
            let identifyMessage = [
                "type": "identify",
                "clientType": "transcriber",
                "clientName": "iPhone Transcriber"
            ] as [String : Any]
            
            if let data = try? JSONSerialization.data(withJSONObject: identifyMessage) {
                self.webSocket?.send(.data(data)) { error in
                    if let error = error {
                        Logger.shared.log("Error sending identify message: \(error.localizedDescription)")
                    } else {
                        Logger.shared.log("Sent identify message as transcriber")
                    }
                }
            }
            
            // Start periodic status checks
            DispatchQueue.main.async {
                self.startStatusChecks()
            }
        }
    }
    
    func startRecognition() {
        guard isConnected else { return }
        guard let sampleRate = self.sampleRate else {
            Logger.shared.log("ERROR: Sample rate not set before starting recognition.")
            return
        }
        
        let startMessage = [
            "type": "start",
            "languageCode": "en-US",
            "sampleRate": sampleRate
        ] as [String : Any]
        
        if let data = try? JSONSerialization.data(withJSONObject: startMessage) {
            webSocket?.send(.data(data)) { [weak self] error in
                if let error = error {
                    Logger.shared.log("Error starting recognition: \(error.localizedDescription)")
                } else {
                    self?.isRecognizing = true
                    Logger.shared.log("Started recognition stream")
                    // Notify backend that mic is active
                    self?.sendMicStatus(active: true)
                }
            }
        }
    }
    
    func stopRecognition() {
        guard isConnected else { return }
        
        let stopMessage = ["type": "stop"]
        if let data = try? JSONSerialization.data(withJSONObject: stopMessage) {
            webSocket?.send(.data(data)) { [weak self] _ in
                self?.isRecognizing = false
                self?.firstPacketSent = false
                Logger.shared.log("Stopped recognition stream")
                // Notify backend that mic is inactive
                self?.sendMicStatus(active: false)
            }
        }
    }
    
    func disconnect() {
        // Stop recognition first if active
        if isRecognizing {
            stopRecognition()
        }
        
        // Stop status checks
        statusCheckTimer?.invalidate()
        statusCheckTimer = nil
        
        isIntentionalDisconnect = true
        webSocket?.cancel(with: .goingAway, reason: nil)
        isConnected = false
        connectionStatus = "Disconnected"
    }
    
    private func startStatusChecks() {
        // Prevent multiple timers
        if statusCheckTimer != nil {
            Logger.shared.log("Status check timer already running, skipping")
            return
        }
        
        // Do an immediate check
        requestServerStatus()
        
        // Check status every 1 second
        statusCheckTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Logger.shared.log("Status check timer fired at \(Date())")
            self?.requestServerStatus()
        }
        
        // Ensure timer is added to run loop
        if let timer = statusCheckTimer {
            RunLoop.main.add(timer, forMode: .common)
        }
        
        Logger.shared.log("Status check timer started")
    }
    
    func requestServerStatus() {
        guard isConnected else { 
            Logger.shared.log("Cannot request status - not connected")
            return 
        }
        
        Logger.shared.log("Requesting server status...")
        let statusRequest = ["type": "requestStatus"]
        if let data = try? JSONSerialization.data(withJSONObject: statusRequest) {
            webSocket?.send(.data(data)) { error in
                if let error = error {
                    Logger.shared.log("Error requesting status: \(error)")
                } else {
                    Logger.shared.log("Status request sent successfully")
                }
            }
        }
    }
    
    func sendAudioData(_ audioData: Data) {
        guard isConnected else { return }
        
        webSocket?.send(.data(audioData)) { [weak self] error in
            if let error = error {
                Logger.shared.log("Error sending audio: \(error)")
                print("Error sending audio: \(error)")
            } else {
                // Successfully sent audio packet
                if let self = self, !self.firstPacketSent {
                    self.firstPacketSent = true
                    Logger.shared.log("✅ First audio packet sent successfully")
                    DispatchQueue.main.async {
                        self.onFirstAudioPacketSent?()
                    }
                }
            }
        }
    }
    
    func clearTranscriptions() {
        transcriptionText = ""
        currentUtterance = ""
        interimText = ""
    }
    
    func clearTranscription() {
        clearTranscriptions()
    }
    
    func sendStopMessage() {
        guard isConnected else { return }
        
        Logger.shared.log("📤 Sending stop forwarding message")
        let stopMessage = ["type": "stopForwarding"]
        if let data = try? JSONSerialization.data(withJSONObject: stopMessage) {
            webSocket?.send(.data(data)) { error in
                if let error = error {
                    Logger.shared.log("❌ Failed to send stop forwarding: \(error)")
                } else {
                    Logger.shared.log("✅ Stop forwarding message sent")
                }
            }
        }
    }
    
    func sendEscapeKeyPress() {
        guard isConnected else {
            Logger.shared.log("❌ Cannot send escape key - not connected")
            return
        }
        
        Logger.shared.log("📤 Sending escape key press to stop Claude Code")
        let escapeMessage = [
            "type": "keyPress",
            "key": "escape"
        ]
        if let data = try? JSONSerialization.data(withJSONObject: escapeMessage) {
            webSocket?.send(.data(data)) { error in
                if let error = error {
                    Logger.shared.log("❌ Failed to send escape key: \(error)")
                } else {
                    Logger.shared.log("✅ Escape key press sent")
                }
            }
        }
    }
    
    func sendTTSToggle(enabled: Bool) {
        guard isConnected else {
            Logger.shared.log("❌ Cannot send TTS toggle - not connected")
            return
        }
        
        Logger.shared.log("📤 Sending TTS toggle: \(enabled)")
        let ttsMessage: [String: Any] = [
            "type": "ttsToggle",
            "enabled": enabled
        ]
        if let data = try? JSONSerialization.data(withJSONObject: ttsMessage) {
            webSocket?.send(.data(data)) { error in
                if let error = error {
                    Logger.shared.log("❌ Failed to send TTS toggle: \(error)")
                } else {
                    Logger.shared.log("✅ TTS toggle sent: \(enabled)")
                }
            }
        }
    }
    
    func sendTTSProcessControl(enabled: Bool) {
        guard isConnected else {
            Logger.shared.log("❌ Cannot send TTS process control - not connected")
            return
        }
        
        Logger.shared.log("📤 Sending TTS process control: \(enabled ? "start" : "stop")")
        let controlMessage: [String: Any] = [
            "type": "ttsProcessControl",
            "action": enabled ? "start" : "stop"
        ]
        if let data = try? JSONSerialization.data(withJSONObject: controlMessage) {
            webSocket?.send(.data(data)) { error in
                if let error = error {
                    Logger.shared.log("❌ Failed to send TTS process control: \(error)")
                } else {
                    Logger.shared.log("✅ TTS process control sent: \(enabled ? "start" : "stop")")
                }
            }
        }
    }
    
    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            guard let self = self else { return }
            
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleMessage(text)
                    }
                @unknown default:
                    break
                }
                
                // Continue receiving messages
                self.receiveMessage()
                
            case .failure(let error):
                // Only log and update status if this wasn't an intentional disconnect
                if !self.isIntentionalDisconnect {
                    Logger.shared.log("WebSocket receive error: \(error)")
                    print("WebSocket receive error: \(error)")
                    self.connectionStatus = "Disconnected: \(error.localizedDescription)"
                }
                self.isConnected = false
            }
        }
    }
    
    private func handleMessage(_ jsonString: String) {
        guard let data = jsonString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }
        
        DispatchQueue.main.async {
            switch type {
            case "connection":
                self.connectionStatus = json["message"] as? String ?? "Connected"
                if let statuses = json["serverStatuses"] as? [String: Bool] {
                    self.serverStatuses = statuses
                }
                
            case "transcript":
                if let transcript = json["transcript"] as? String,
                   let isFinal = json["isFinal"] as? Bool {
                    // Check if delta is provided (new format) or use full transcript (old format)
                    let delta = json["delta"] as? String ?? transcript
                    
                    Logger.shared.log("Received transcript - Final: \(isFinal), Text: \(transcript)")
                    if isFinal {
                        // Final transcript - store it and notify
                        if !transcript.trimmingCharacters(in: .whitespaces).isEmpty {
                            self.latestFinalTranscript = transcript
                            self.transcriptionText = self.transcriptionText + transcript + "\n"
                            print("FINAL TRANSCRIPT: '\(transcript)'")
                            
                            // Call the completion callback
                            DispatchQueue.main.async {
                                self.onTranscriptionComplete?(transcript)
                            }
                        }
                        self.currentUtterance = ""
                        self.interimText = ""
                    } else {
                        // Interim transcript - show the full transcript
                        self.currentUtterance = transcript
                        self.interimText = transcript
                        print("INTERIM TRANSCRIPT: '\(transcript)'")
                    }
                }
                
            case "error":
                if let error = json["error"] as? String {
                    self.connectionStatus = "Error: \(error)"
                    // If TTS narrator not connected, reset TTS toggle state
                    if error.contains("TTS Narrator not connected") {
                        Logger.shared.log("TTS Narrator not connected - resetting toggle state")
                        // Reset to current state (don't change)
                        self.onTTSStateChanged?(true) // Assume it's still on
                    }
                }
                
            case "serverStatusUpdate":
                if let statuses = json["serverStatuses"] as? [String: Bool] {
                    self.serverStatuses = statuses
                    Logger.shared.log("Server statuses updated: \(statuses)")
                    // Notify UI to reset ping animation
                    self.onStatusUpdate?()
                }
                
            case "ttsState":
                if let enabled = json["enabled"] as? Bool {
                    Logger.shared.log("TTS state confirmed: \(enabled)")
                    // Notify UI to update TTS button state
                    self.onTTSStateChanged?(enabled)
                }
                
            default:
                break
            }
        }
    }
    
    func sendHelpMessage() {
        guard isConnected else {
            Logger.shared.log("❌ Cannot send help message - not connected")
            return
        }
        
        Logger.shared.log("🆘 Sending emergency help message")
        let helpMessage: [String: Any] = [
            "type": "helpMessage",
            "message": "EMERGENCY: User cannot interact with system. User pressed help button. Assume user is paraplegic and can only use voice. Fix voice control immediately."
        ]
        
        if let data = try? JSONSerialization.data(withJSONObject: helpMessage) {
            webSocket?.send(.data(data)) { error in
                if let error = error {
                    Logger.shared.log("❌ Failed to send help message: \(error)")
                } else {
                    Logger.shared.log("✅ Help message sent successfully")
                }
            }
        }
    }
    
    func sendMicStatus(active: Bool) {
        guard isConnected else { return }
        
        Logger.shared.log("🎤 Sending mic status: \(active ? "active" : "inactive")")
        let micMessage: [String: Any] = [
            "type": "micStatus",
            "active": active
        ]
        if let data = try? JSONSerialization.data(withJSONObject: micMessage) {
            webSocket?.send(.data(data)) { error in
                if let error = error {
                    Logger.shared.log("❌ Failed to send mic status: \(error)")
                } else {
                    Logger.shared.log("✅ Mic status sent: \(active ? "active" : "inactive")")
                }
            }
        }
    }
}