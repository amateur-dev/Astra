const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return

  const appOutDir = context.appOutDir
  const productFilename = context.packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${productFilename}.app`)
  const entitlementsPath = path.resolve(__dirname, '..', 'build', 'entitlements.mac.plist')
  const inheritPath = path.resolve(__dirname, '..', 'build', 'entitlements.mac.inherit.plist')

  if (!fs.existsSync(entitlementsPath)) {
    console.error(`[afterSign] Entitlements file not found: ${entitlementsPath}`)
    return
  }

  console.log(`[afterSign] Re-signing ${appPath} with entitlements...`)

  const runCodesign = (target, extraFlags = '') => {
    const cmd = `codesign --force --options runtime ${extraFlags} -s - "${target}"`
    console.log(`[afterSign] > codesign ${path.basename(target)}`)
    execSync(cmd, { stdio: 'inherit' })
  }

  try {
    // Step 1: Sign all frameworks inside the app (no special entitlements)
    const frameworksDir = path.join(appPath, 'Contents', 'Frameworks')
    if (fs.existsSync(frameworksDir)) {
      fs.readdirSync(frameworksDir).forEach(entry => {
        if (entry.endsWith('.framework') && !entry.startsWith('Electron Framework')) {
          runCodesign(path.join(frameworksDir, entry))
        }
        if (entry.endsWith('.dylib')) {
          runCodesign(path.join(frameworksDir, entry))
        }
      })

      // Sign Electron Framework itself (recursively with --deep)
      const efPath = path.join(frameworksDir, 'Electron Framework.framework')
      if (fs.existsSync(efPath)) {
        runCodesign(efPath, '--deep')
      }
    }

    // Step 2: Sign helper apps with INHERIT entitlements (limited scope)
    const allHelpPaths = []

    // Helpers inside Electron Framework
    const efHelpersDir = path.join(frameworksDir, 'Electron Framework.framework', 'Versions', 'A', 'Helpers')
    if (fs.existsSync(efHelpersDir)) {
      fs.readdirSync(efHelpersDir).filter(f => f.endsWith('.app')).forEach(f => {
        allHelpPaths.push(path.join(efHelpersDir, f))
      })
    }

    // Helpers placed directly in Frameworks/ by electron-builder
    if (fs.existsSync(frameworksDir)) {
      fs.readdirSync(frameworksDir).filter(f => f.endsWith('.app')).forEach(f => {
        allHelpPaths.push(path.join(frameworksDir, f))
      })
    }

    for (const helperPath of allHelpPaths) {
      console.log(`[afterSign] Signing helper (inherit): ${path.basename(helperPath)}`)
      execSync(
        `codesign --force --deep --options runtime -s - --entitlements "${inheritPath}" "${helperPath}"`,
        { stdio: 'inherit' }
      )
    }

    // Step 3: Sign the main app LAST (without --deep to preserve helper entitlements)
    console.log('[afterSign] Signing main app with full entitlements...')
    execSync(
      `codesign --force --options runtime -s - --entitlements "${entitlementsPath}" "${appPath}"`,
      { stdio: 'inherit' }
    )

    // Final verification
    const spctlCheck = execSync(`spctl -a -v "${appPath}" 2>&1 || true`, { encoding: 'utf8' })
    if (spctlCheck.includes('accepted') || spctlCheck.includes('satisfies')) {
      console.log('[afterSign] Gatekeeper: ACCEPTED')
    } else {
      console.log(`[afterSign] Gatekeeper note: ${spctlCheck.trim()}`)
      console.log('[afterSign] (This is normal for ad-hoc signed apps. Users need to right-click → Open the first time.)')
    }

    const verify = execSync(`codesign -d --entitlements - "${appPath}"`, { encoding: 'utf8' })
    if (verify.includes('audio-input')) {
      console.log('[afterSign] Microphone entitlement confirmed embedded.')
    } else {
      console.error('[afterSign] WARNING: Microphone entitlement NOT found!')
      console.error(verify)
    }

    console.log('[afterSign] Done.')
  } catch (err) {
    console.error('[afterSign] Signing failed:', err.message)
    throw err
  }
}
