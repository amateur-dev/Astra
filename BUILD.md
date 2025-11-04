# Building Voice Hotkey App

## Prerequisites

- macOS 13.0 or later
- Xcode 15.0 or later

## Build Steps

### Using Xcode

1. Open the project:
   ```bash
   open VoiceHotkeyApp/VoiceHotkeyApp.xcodeproj
   ```

2. Select the "VoiceHotkeyApp" scheme

3. Build the project:
   - Press `Cmd+B` to build
   - Press `Cmd+R` to build and run

### Using Command Line

```bash
cd VoiceHotkeyApp
xcodebuild -project VoiceHotkeyApp.xcodeproj -scheme VoiceHotkeyApp -configuration Debug build
```

### Code Signing

For development builds, you can use automatic code signing:
1. Open the project in Xcode
2. Select the "VoiceHotkeyApp" target
3. In "Signing & Capabilities", check "Automatically manage signing"
4. Select your development team

For distribution, you'll need to:
1. Join the Apple Developer Program
2. Create a Developer ID Application certificate
3. Configure proper entitlements
4. Notarize the app

## Troubleshooting

### Build Errors

If you encounter build errors:

1. **Missing Frameworks**: Ensure you're using macOS 13.0 SDK or later
2. **Code Signing**: Make sure you have a valid signing certificate
3. **Entitlements**: Verify the entitlements file is properly configured

### Runtime Issues

If the app doesn't work as expected:

1. **Permissions**: Check System Preferences > Security & Privacy > Privacy
   - Accessibility: Enable for Voice Hotkey App
   - Microphone: Grant access
   - Speech Recognition: Grant access

2. **Hotkey Not Working**: Verify accessibility permissions are granted

3. **No Audio Input**: Check microphone permissions in System Preferences

## Project Structure

```
VoiceHotkeyApp/
├── VoiceHotkeyApp.xcodeproj/
│   └── project.pbxproj
└── VoiceHotkeyApp/
    ├── AppDelegate.swift
    ├── StatusBarController.swift
    ├── HotkeyManager.swift
    ├── VoiceRecognitionManager.swift
    ├── PermissionManager.swift
    ├── PreferencesWindow.swift
    ├── Assets.xcassets/
    ├── Info.plist
    └── VoiceHotkeyApp.entitlements
```

## Frameworks Used

- AppKit (Cocoa)
- AVFoundation (Audio capture)
- Speech (Speech recognition)
- Carbon (Global hotkeys)
- CoreGraphics (Synthetic keyboard events)
