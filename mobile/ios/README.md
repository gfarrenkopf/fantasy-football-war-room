# Draft Room for iOS

The native iPhone app: SwiftUI, iOS 18 and later, no third-party packages. The plan behind it, and the runbook from enrollment to TestFlight, is [`docs/ios.md`](../../docs/ios.md).

The app is a client of the hosted server (`/api/v1/`), so it needs a server with cloud features on. Self-hosting the web app is unaffected.

## Open and run

1. Install Xcode (see `docs/ios.md` §9) and point the command-line tools at it: `sudo xcode-select -s /Applications/Xcode.app`.
2. Open `mobile/ios/DraftRoom.xcodeproj`.
3. Pick the **DraftRoom** scheme and an iPhone simulator, then press ⌘R.

Debug builds talk to `http://localhost:3000`, so start the web app first (`npm run dev` at the repo root, with cloud features configured; see `docs/database.md`). Release builds talk to `https://draftroom.online`. The URL comes from the `API_BASE_URL` build setting, which Info.plist passes to the app as `APIBaseURL`; Swift code reads it through `AppEnvironment`.

Until the Apple Developer enrollment clears (Epic 16), build for the simulator only. From the command line, add `CODE_SIGNING_ALLOWED=NO`.

## Test

```sh
xcodebuild test -project mobile/ios/DraftRoom.xcodeproj -scheme DraftRoom \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

- `DraftRoomTests/` holds unit tests written with Swift Testing (`import Testing`), run inside the app.
- `DraftRoomUITests/` holds the XCUITest smoke tests, which launch the app.

## Layout

The project uses folder-synchronized groups: any file added under `DraftRoom/`, `DraftRoomTests/` or `DraftRoomUITests/` joins its target automatically, with no project-file edit.

| Folder | What goes there |
|---|---|
| `DraftRoom/App/` | The `@main` app and top-level scene |
| `DraftRoom/Features/` | One folder per screen: its views and its `@Observable` model |
| `DraftRoom/API/` | The API client and the `Codable` types for `/api/v1/` |
| `DraftRoom/Design/` | Design tokens (generated from `src/app/globals.css`) and shared components |
| `DraftRoom/Support/` | Keychain, environment and other plumbing |

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
