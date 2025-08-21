import Foundation
import Observation

/**
 * iOS Logger with automatic function and class name detection and backend forwarding
 * 
 * Features:
 * - Automatic function name detection via Swift's #function
 * - Automatic class name detection via type inference
 * - Single message parameter - no manual function/class names needed
 * - Pluggable logging callback for backend forwarding
 * - Default file logging plus console output
 * 
 * Usage:
 *   Logger.shared.log("Something happened")        // LOG | iOS | ClassName | functionName | Something happened
 *   Logger.shared.error("Error occurred")          // ERROR | iOS | ClassName | functionName | Error occurred
 */
@Observable
class Logger {
    static let shared = Logger()
    
    // Callback for forwarding logs to backend
    var loggingCallback: ((String, String, String, String, String) -> Void)?
    
    
    private func writeLog(_ level: String, _ message: String, file: String = #file, function: String = #function) {
        let className = extractClassName(from: file)
        let functionName = extractFunctionName(from: function)
        
        let consoleMessage = "\(level) | iOS | \(className) | \(functionName) | \(message)"
        
        // Always console log first (can't fail)
        print(consoleMessage)
        
        // Use callback for backend forwarding if available
        loggingCallback?(level, "iOS", className, functionName, message)
    }
    
    private func extractClassName(from file: String) -> String {
        let filename = URL(fileURLWithPath: file).deletingPathExtension().lastPathComponent
        return filename
    }
    
    private func extractFunctionName(from function: String) -> String {
        // Swift #function gives us "functionName(param1:param2:)" - extract just the name
        if let parenIndex = function.firstIndex(of: "(") {
            return String(function[..<parenIndex])
        }
        return function
    }
    
    func log(_ message: String, file: String = #file, function: String = #function) {
        writeLog("LOG", message, file: file, function: function)
    }
    
    func error(_ message: String, file: String = #file, function: String = #function) {
        writeLog("ERROR", message, file: file, function: function)
    }
    
}