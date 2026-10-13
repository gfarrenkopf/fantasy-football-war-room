# Draft Room for iOS

The native iPhone app: SwiftUI, iOS 18 and later, no third-party packages. The plan behind it, and the runbook from enrollment to TestFlight, is [`docs/ios.md`](../../docs/ios.md).

The app is a client of the hosted server (`/api/v1/`), so it needs a server with cloud features on. Self-hosting the web app is unaffected.

## Open and run

1. Install Xcode (see `docs/ios.md` §9) and point the command-line tools at it: `sudo xcode-select -s /Applications/Xcode.app`.
2. Open `mobile/ios/DraftRoom.xcodeproj`.
3. Pick the **DraftRoom** scheme and an iPhone simulator, then press ⌘R.

Debug builds talk to `http://localhost:3000`, so start the web app first (`npm run dev` at the repo root, with cloud features configured; see `docs/database.md`). Release builds talk to `https://draftroom.online`. The URL comes from the `API_BASE_URL` build setting, which Info.plist passes to the app as `APIBaseURL`; Swift code reads it through `AppEnvironment`.

Until the Apple Developer enrollment clears (Epic 16), build for the simulator only. From the command line, add `CODE_SIGNING_ALLOWED=NO`.

## Signing in on the simulator

The app signs in three ways (`docs/ios.md` §4): Sign in with Apple, Google through the system browser sheet, and an emailed link. Against the local dev server:

- **Apple** needs a signed build with the Sign in with Apple capability, so it waits for the Apple team (Epic 16).
- **Google** works when the dev server has `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. On a dev server, the hand-off comes back through the app's `draftroom://` scheme, not a Universal Link.
- **Email** sends a real link. Universal Links don't work for `localhost`, so open the link's `email` and `token` through the app's scheme: `xcrun simctl openurl booted "draftroom://auth/email?email=<email>&token=<token>"`.

Unsigned builds (`CODE_SIGNING_ALLOWED=NO`) can't use the Keychain. Debug builds then keep the session in memory, so signing in works until the app quits, and the Keychain test is skipped.

## Test

```sh
xcodebuild test -project mobile/ios/DraftRoom.xcodeproj -scheme DraftRoom \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

- `DraftRoomTests/` holds unit tests written with Swift Testing (`import Testing`), run inside the app.
- `DraftRoomUITests/` holds the XCUITest smoke tests, which launch the app.

Debug builds launched with `-uiTestStub` answer the API from canned JSON (`Support/UITestStub.swift`): signed in, with two leagues. UI tests use it to drive the signed-in app without a server, and it's handy for screenshots: `xcrun simctl launch booted tech.apeman.draftroom -uiTestStub`. Release builds don't contain it.

## Layout

The project uses folder-synchronized groups: any file added under `DraftRoom/`, `DraftRoomTests/` or `DraftRoomUITests/` joins its target automatically, with no project-file edit.

| Folder | What goes there |
|---|---|
| `DraftRoom/App/` | The `@main` app and top-level scene |
| `DraftRoom/Features/` | One folder per screen: its views and its `@Observable` model |
| `DraftRoom/API/` | The API client and the `Codable` types for `/api/v1/` |
| `DraftRoom/Design/` | Design tokens (generated from `src/app/globals.css`) and shared components |
| `DraftRoom/Support/` | Keychain, environment and other plumbing |

## Design tokens

`DraftRoom/Design/Tokens.swift` is generated from the web's tokens (the `@theme` block in `src/app/globals.css` for colors, and `DESIGN.md` for the type scale, radii and spacing). Never edit it by hand. After changing a web token, run `npm run ios:tokens` and commit the result; web CI fails while the file is stale.

UI code uses token names only, never raw hex, the same as the web's Tailwind rule:

- colors: `.foregroundStyle(.muted)`, `.background(.panel)`
- type: `.typeStyle(TypeScale.body)`
- radii and spacing: `Radius.card`, `Spacing.md`

`Design/Typography.swift` explains how web sizes map to the iPhone. `Design/Motion.swift` holds the shared springs (`Motion.settle`, `Motion.respond`, `Motion.press`) and haptics (`Haptic.success`, `Haptic.choice`); use them rather than one-off values.

The app icon (`Assets.xcassets/AppIcon`, with light, dark and tinted variants) is the web's `src/app/icon.svg` board drawn at 1024 px. The launch screen is the `bg` token (`LaunchBackground`). `Design/TokenSwatches.swift` is a preview-only sheet of the tokens.

## Swift

Swift 6 language mode is on, so strict concurrency checking is too. State lives in `@Observable` classes.

## Xcode Cloud

Xcode Cloud workflows are stored in App Store Connect, not in this repo, so they're set up by hand once the repo is connected (ticket 16.5). Create these two:

- **PR**
  - Start condition: pull request changes, with the files and folders condition set to `mobile/ios/`.
  - Action: Test, scheme `DraftRoom`, on the latest release of iOS for iPhone 17.
- **Main**
  - Start condition: branch changes on `main`, with the files and folders condition set to `mobile/ios/`.
  - Action: Archive, scheme `DraftRoom`, for iOS.
  - Post-action: TestFlight Internal Testing.

Xcode Cloud runs scripts from `mobile/ios/ci_scripts/` if one is ever needed (for example `ci_post_clone.sh`). None is needed today.
