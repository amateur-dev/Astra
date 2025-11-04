# Testing Guide for Voice Hotkey App

## Pre-Testing Setup

Before testing, ensure you have:
1. macOS 13.0 or later
2. Built the app successfully in Xcode
3. A working microphone
4. Granted all necessary permissions

## Permission Tests

### Test 1: Accessibility Permission
**Steps:**
1. Launch the app for the first time
2. Should see an alert about accessibility permissions
3. Click "Open System Preferences"
4. Enable accessibility for VoiceHotkeyApp
5. Restart the app

**Expected:** App should have accessibility access, hotkey should work

### Test 2: Microphone Permission
**Steps:**
1. Launch the app
2. Should see a system prompt for microphone access
3. Click "OK" to grant access

**Expected:** App can access microphone for recording

### Test 3: Speech Recognition Permission
**Steps:**
1. Launch the app
2. Should see a system prompt for speech recognition
3. Click "OK" to grant access

**Expected:** App can use speech recognition

## Functionality Tests

### Test 4: Menu Bar Icon
**Steps:**
1. Launch the app
2. Look for microphone icon in menu bar

**Expected:** 
- Microphone icon appears in menu bar
- Clicking shows menu with options

### Test 5: Push-to-Talk Mode
**Steps:**
1. Ensure mode is set to "Push-to-Talk" in menu
2. Press Cmd+Shift+V
3. Speak: "Hello world"
4. Wait for recognition to complete

**Expected:**
- Recording starts when hotkey is pressed
- Menu bar shows "Recording..." status
- Text "Hello world" is inserted at cursor position
- Recording stops automatically

### Test 6: Toggle Mode
**Steps:**
1. Click menu bar icon
2. Select "Mode: Toggle"
3. Press Cmd+Shift+V to start recording
4. Speak: "This is a test"
5. Press Cmd+Shift+V again to stop

**Expected:**
- Recording starts on first press
- Menu bar shows "Recording..." status
- Recording continues until second press
- Text is inserted at cursor position

### Test 7: Text Insertion
**Steps:**
1. Open TextEdit or any text editor
2. Click in the text area
3. Activate voice recognition
4. Speak clearly: "Testing voice to text"

**Expected:**
- Text "Testing voice to text" appears at cursor
- Previous clipboard content is restored after paste

### Test 8: Preferences Window
**Steps:**
1. Click menu bar icon
2. Select "Preferences..."

**Expected:**
- Preferences window opens
- Shows current hotkey (⌘⇧V)
- Shows mode descriptions
- Shows required permissions list

### Test 9: Quit Application
**Steps:**
1. Click menu bar icon
2. Select "Quit"

**Expected:**
- App quits cleanly
- Menu bar icon disappears

## Edge Cases

### Test 10: No Microphone
**Steps:**
1. Disconnect all microphones
2. Try to activate voice recognition

**Expected:**
- App handles gracefully
- Shows appropriate error or notification

### Test 11: Background Noise
**Steps:**
1. Play music or have background noise
2. Activate voice recognition
3. Speak clearly

**Expected:**
- Recognition still works reasonably well
- May have reduced accuracy (expected)

### Test 12: Multiple Rapid Activations
**Steps:**
1. Press hotkey multiple times rapidly

**Expected:**
- App handles gracefully without crashing
- Only one recording session active at a time

### Test 13: Long Recording (Toggle Mode)
**Steps:**
1. Switch to Toggle mode
2. Start recording
3. Speak for 1+ minute
4. Stop recording

**Expected:**
- Recording continues throughout
- All text is captured and inserted

### Test 14: Special Characters
**Steps:**
1. Activate voice recognition
2. Speak: "Question mark, exclamation point, comma, period"

**Expected:**
- Punctuation is inserted: "? ! , ."

### Test 15: Different Applications
**Steps:**
1. Test in various apps:
   - TextEdit
   - Safari (address bar, text fields)
   - Notes
   - Messages
   - Mail

**Expected:**
- Text insertion works in all apps
- Cmd+V synthetic event is recognized

## Performance Tests

### Test 16: Recognition Latency
**Steps:**
1. Activate voice recognition
2. Speak immediately
3. Note time until text appears

**Expected:**
- Partial results appear within 1-2 seconds
- Final text appears quickly after speech ends

### Test 17: Memory Usage
**Steps:**
1. Monitor memory in Activity Monitor
2. Use app normally for 30 minutes
3. Check for memory leaks

**Expected:**
- Memory usage remains stable
- No significant leaks

### Test 18: CPU Usage While Idle
**Steps:**
1. Launch app
2. Don't activate voice recognition
3. Monitor CPU in Activity Monitor

**Expected:**
- Near 0% CPU when idle
- Only minimal background activity

## Known Limitations

1. **Push-to-Talk Mode**: Currently uses a timeout instead of detecting key release (due to API limitations). Recording stops after 5 seconds or when speech ends.

2. **Hotkey Rebinding**: UI shows current hotkey but rebinding functionality is noted as "coming in future update" in preferences.

3. **Clipboard Restoration**: Brief delay before clipboard is restored to prevent conflicts.

4. **On-Device Recognition**: Requires macOS 13.0+ for reliable on-device speech recognition.

## Troubleshooting Test Failures

### Hotkey Not Working
- Verify accessibility permissions in System Preferences
- Check if another app is using the same hotkey
- Try restarting the app

### No Audio Input
- Check microphone is connected and selected as input device
- Verify microphone permission is granted
- Test microphone in System Preferences > Sound

### Text Not Inserting
- Verify accessibility permissions (required for synthetic events)
- Test manual Cmd+V in target application
- Check if target app accepts paste events

### App Crashes
- Check Console app for crash logs
- Verify all permissions are granted
- Ensure running macOS 13.0 or later

## Regression Testing

After any code changes, re-run:
- Test 1-3 (Permissions)
- Test 5-6 (Core functionality)
- Test 7 (Text insertion)
- Test 15 (Different apps)

## Manual Code Review Checklist

- [ ] All Swift files compile without warnings
- [ ] Memory management: No retain cycles
- [ ] Error handling: All potential failures handled
- [ ] Thread safety: UI updates on main thread
- [ ] Resource cleanup: Audio engine properly stopped
- [ ] Permission checks before accessing protected resources
- [ ] Entitlements match required permissions
