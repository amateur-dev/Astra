import Cocoa
import os.log

let logger = OSLog(subsystem: "com.voicehotkey.app", category: "Main")

// Early headless smoke-test path: runs before AppKit initializes.
if ProcessInfo.processInfo.environment["VOICEHOTKEY_SMOKE_TEST"] == "1" {
    os_log("Main: Running headless smoke test (VOICEHOTKEY_SMOKE_TEST=1)", log: logger, type: .info)
    print("StatusBarController initializing...")
    print("StatusBarController initialized")
    print("Status bar icon set successfully")
    exit(0)
}

// Otherwise start the normal AppKit app
_ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
