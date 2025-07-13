import Foundation

class Logger {
    static let shared = Logger()
    private let logFile: URL
    private let dateFormatter: DateFormatter
    
    private init() {
        // Create log file in Documents directory
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        logFile = documentsPath.appendingPathComponent("ClaudeCodeMicrophone.log")
        
        dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "HH:mm:ss.SSS"
        
        // Clear log file on app start
        try? "=== ClaudeCodeMicrophone Started ===\n".write(to: logFile, atomically: true, encoding: .utf8)
    }
    
    func log(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        let timestamp = dateFormatter.string(from: Date())
        let filename = URL(fileURLWithPath: file).lastPathComponent
        let logMessage = "[\(timestamp)] \(filename):\(line) - \(message)\n"
        
        // Print to console
        print(logMessage, terminator: "")
        
        // Write to file
        if let data = logMessage.data(using: .utf8) {
            if FileManager.default.fileExists(atPath: logFile.path) {
                if let fileHandle = try? FileHandle(forWritingTo: logFile) {
                    fileHandle.seekToEndOfFile()
                    fileHandle.write(data)
                    fileHandle.closeFile()
                }
            } else {
                try? data.write(to: logFile)
            }
        }
    }
    
    func getLogContents() -> String {
        return (try? String(contentsOf: logFile, encoding: .utf8)) ?? "No logs available"
    }
    
    func getLogFilePath() -> String {
        return logFile.path
    }
}