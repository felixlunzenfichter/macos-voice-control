# iOS 18 @Observable Pattern - CRITICAL

**NEVER USE @StateObject WITH @Observable CLASSES**

This project uses iOS 18's @Observable macro pattern. When working with @Observable classes:

## ✅ CORRECT Pattern (iOS 17+):
```swift
import Observation

@Observable
class MyClass {
    var property = "value"
}

struct ContentView: View {
    @State private var myClass = MyClass()  // Use @State, NOT @StateObject
}
```

## ❌ WRONG Pattern (Old iOS):
```swift
// DO NOT USE THIS PATTERN
class MyClass: ObservableObject {
    @Published var property = "value"
}

struct ContentView: View {
    @StateObject private var myClass = MyClass()  // WRONG for @Observable
}
```

## Key Rules:
1. Classes use `@Observable` macro, not `ObservableObject`
2. Properties in @Observable classes don't need `@Published`
3. Views use `@State` to hold @Observable instances, NOT `@StateObject`
4. Import `Observation` framework when using @Observable
5. This is iOS 18 code. Always use the modern @Observable pattern.

## Why This Matters:
- @StateObject is for ObservableObject protocol (old pattern)
- @State is for @Observable macro (new pattern in iOS 17+)
- Mixing them causes build errors like "expected declaration"
- The GoogleBackend, AudioManager, and MotionManager all use @Observable