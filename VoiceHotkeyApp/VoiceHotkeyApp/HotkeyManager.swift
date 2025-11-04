import Cocoa
import Carbon

class HotkeyManager {
    static let shared = HotkeyManager()
    
    private var eventHotKey: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private var hotkeyCallback: (() -> Void)?
    
    // Current hotkey configuration (default: Cmd+Shift+V)
    private var currentKeyCode: UInt32 = UInt32(kVK_ANSI_V)
    private var currentModifiers: UInt32 = UInt32(cmdKey | shiftKey)
    
    private init() {}
    
    // Register the global hotkey
    func registerHotkey(keyCode: UInt32? = nil, modifiers: UInt32? = nil, callback: @escaping () -> Void) {
        // Update if provided
        if let keyCode = keyCode {
            currentKeyCode = keyCode
        }
        if let modifiers = modifiers {
            currentModifiers = modifiers
        }
        
        hotkeyCallback = callback
        
        // Unregister existing hotkey
        unregisterHotkey()
        
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                      eventKind: OSType(kEventHotKeyPressed))
        
        InstallEventHandler(GetApplicationEventTarget(), { (nextHandler, theEvent, userData) -> OSStatus in
            var hotkeyID = EventHotKeyID()
            GetEventParameter(theEvent,
                            EventParamName(kEventParamDirectObject),
                            EventParamType(typeEventHotKeyID),
                            nil,
                            MemoryLayout<EventHotKeyID>.size,
                            nil,
                            &hotkeyID)
            
            if let manager = userData?.assumingMemoryBound(to: HotkeyManager.self).pointee {
                manager.hotkeyCallback?()
            }
            
            return noErr
        }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &eventHandler)
        
        var hotkeyID = EventHotKeyID(signature: OSType(UTGetOSTypeFromString("VHKA" as CFString)),
                                     id: 1)
        
        RegisterEventHotKey(currentKeyCode,
                           currentModifiers,
                           hotkeyID,
                           GetApplicationEventTarget(),
                           0,
                           &eventHotKey)
    }
    
    // Unregister the current hotkey
    func unregisterHotkey() {
        if let eventHotKey = eventHotKey {
            UnregisterEventHotKey(eventHotKey)
            self.eventHotKey = nil
        }
        
        if let eventHandler = eventHandler {
            RemoveEventHandler(eventHandler)
            self.eventHandler = nil
        }
    }
    
    // Get key code from character
    static func keyCodeForCharacter(_ character: String) -> UInt32? {
        let keyMap: [String: UInt32] = [
            "a": UInt32(kVK_ANSI_A), "b": UInt32(kVK_ANSI_B), "c": UInt32(kVK_ANSI_C),
            "d": UInt32(kVK_ANSI_D), "e": UInt32(kVK_ANSI_E), "f": UInt32(kVK_ANSI_F),
            "g": UInt32(kVK_ANSI_G), "h": UInt32(kVK_ANSI_H), "i": UInt32(kVK_ANSI_I),
            "j": UInt32(kVK_ANSI_J), "k": UInt32(kVK_ANSI_K), "l": UInt32(kVK_ANSI_L),
            "m": UInt32(kVK_ANSI_M), "n": UInt32(kVK_ANSI_N), "o": UInt32(kVK_ANSI_O),
            "p": UInt32(kVK_ANSI_P), "q": UInt32(kVK_ANSI_Q), "r": UInt32(kVK_ANSI_R),
            "s": UInt32(kVK_ANSI_S), "t": UInt32(kVK_ANSI_T), "u": UInt32(kVK_ANSI_U),
            "v": UInt32(kVK_ANSI_V), "w": UInt32(kVK_ANSI_W), "x": UInt32(kVK_ANSI_X),
            "y": UInt32(kVK_ANSI_Y), "z": UInt32(kVK_ANSI_Z)
        ]
        return keyMap[character.lowercased()]
    }
    
    // Get modifier flags for display
    func getModifierString() -> String {
        var modifierString = ""
        if currentModifiers & UInt32(cmdKey) != 0 {
            modifierString += "⌘"
        }
        if currentModifiers & UInt32(shiftKey) != 0 {
            modifierString += "⇧"
        }
        if currentModifiers & UInt32(optionKey) != 0 {
            modifierString += "⌥"
        }
        if currentModifiers & UInt32(controlKey) != 0 {
            modifierString += "⌃"
        }
        return modifierString
    }
    
    func getCurrentKeyCode() -> UInt32 {
        return currentKeyCode
    }
    
    func getCurrentModifiers() -> UInt32 {
        return currentModifiers
    }
}
