# Tempo · Interval Timer

A clean, responsive interval timer built with plain HTML, CSS, and JavaScript. No build step, account, package installation, or external assets required.

## Run locally

From this folder:

```sh
python3 -m http.server 8000
```

Open **http://localhost:8000**. Any static web server or static website host also works. To try it on a phone on the same Wi-Fi, open `http://YOUR_COMPUTER_LAN_IP:8000` while the server is running (your firewall must allow the connection). Stop the server with Ctrl+C.

You can also open `index.html` directly. Browsers usually block loading JSON automatically from a `file://` URL; use **Import JSON** to select files from `workouts/` in that case.

## Using the app

- **Your workouts:** open a workout, create one, or delete one with confirmation.
- **Workout screen:** see every exercise, its work duration, and the rest period following it. Use the pencil to edit or the trash icon to delete; use **Add exercise** to extend the lineup.
- **Reordering:** drag the ⠿ handle beside an exercise up or down, using a mouse or touch. A line marks the drop position, and the page scrolls when you drag near its top or bottom edge. The exercise's work duration and following rest move with it; the new order saves automatically. You can also focus a handle and use Up/Down or Home/End. Press Escape or release outside the list to cancel. Starting a drag pauses the timer; a changed order resets the session, while cancellation or an unchanged order leaves the current session paused.
- **Timer:** a circular clock and seconds display count down each work/rest interval. The active exercise or rest also shows its remaining seconds in the lineup. Pause/resume, skip an interval, reset, or start again after completion. Space pauses/resumes when focus is outside a control.
- **Editing:** opening an editor pauses the session; saving an exercise or deleting one resets it. Cancelling leaves it paused. Going back to the library pauses; reopening the same workout resumes from that paused position. Opening another workout starts a new session.
- **Appearance:** the sun/moon button toggles dark mode. The initial theme follows your device; your chosen theme is remembered.
- **Sound:** optional tones mark interval changes and completion. Toggle them with the speaker button.

Work durations accept 1–3600 whole seconds; rest durations accept 0–3600. Rest happens **between exercises only**; the last exercise ends the workout immediately. A zero rest transitions directly to the next exercise. Each collection supports up to 200 workouts and each workout up to 200 exercises.

## Workout files and saving

On first load, the app loads **all JSON files directly inside `workouts/`**, in filename order. Each file uses the version-1 format shown below and may contain several workouts. Subfolders are not scanned. Files with matching workout IDs are kept as separate workouts with unique IDs, so the original and modified warmups both appear.

Once you edit, reorder, import, or explicitly load the folder, the collection is saved in the browser's local storage and takes precedence on later visits. This protects local edits and deletions, including an intentionally empty collection. To refresh an existing saved collection from the folder, choose **Load folder**. It asks before replacing your saved workouts; use **Export JSON** first if you want to keep a backup. If any folder file is missing or invalid, the folder load fails without replacing your collection.

### Adding or removing workout files

With `python3 -m http.server`, directory discovery is automatic: add or remove a `.json` file in `workouts/`, then refresh (for a fresh collection) or choose **Load folder** (for a saved collection).

Static hosts without directory listings use the included `workouts-manifest.json`. After adding, removing, or renaming files, regenerate it before publishing:

```sh
python3 scripts/update_workout_manifest.py
```

Publish the updated manifest together with the `workouts/` folder and app files. The generator scans all JSON filenames automatically; you do not have to maintain the list by hand. Changing the contents of an already-listed file does not require regenerating the manifest. The manifest is a static-host fallback, not a server or cloud sync service.

**Import JSON** lets you select one or several files at once and adds their workouts to your existing collection after confirmation. On desktop, use Command-click (Mac) or Ctrl-click (Windows) to select multiple files; on phones, use the file picker's multi-select option when available. You can also import files one at a time; earlier workouts stay in your collection.

All selected files are validated before any workouts are added. If any file is invalid or the combined collection would exceed 200 workouts, nothing is imported. Importing the same workout again adds a separate copy, so existing edits are never overwritten; conflicting IDs are regenerated automatically. Empty files with a valid empty workouts array do not remove anything.

**Export JSON** downloads the complete collection in one file. Browser edits cannot overwrite a source file automatically: export the collection, then replace the source JSON yourself if desired.

Example:

```json
{
  "version": 1,
  "workouts": [
    {
      "id": "quick-session",
      "name": "Quick session",
      "description": "Two intervals to find your rhythm.",
      "color": "orange",
      "exercises": [
        { "id": "squats", "name": "Squats", "duration": 40, "rest": 20 },
        { "id": "plank", "name": "Plank", "duration": 30, "rest": 0 }
      ]
    }
  ]
}
```

Names are required (maximum 80 characters); descriptions are optional (maximum 240). Colors are `orange`, `purple`, or `green`. IDs may be omitted; missing or duplicate IDs are regenerated. A missing rest defaults to 0. Import size is limited to 2 MB per file.

Local storage is specific to the browser and site address; it does not sync across devices. Use export/import to move a collection or keep a backup. If storage is blocked or full, the app reports that changes need to be exported. Timer progress is held in memory and resets after refreshing or closing the page.

## Timing and mobile behavior

The timer compares a deadline with the clock instead of subtracting one second on every callback. It catches up across delayed callbacks and suspended tabs, including multiple missed intervals. Pausing preserves the exact remaining fraction of a second. The screen stays awake while running on browsers that allow the Screen Wake Lock API (normally HTTPS or localhost).

Mobile browsers can suspend pages and audio when the screen locks or the app is backgrounded. The timer catches up on return, but background sounds are not guaranteed. Keep the page visible for reliable interval cues. Changing the device clock during a session can affect timing.

## Files

- `index.html` — accessible page structure and dialogs.
- `styles.css` — responsive layouts, light and dark themes.
- `app.js` — UI, editing, validation, import/export, persistence, and sound.
- `timer.js` — independent deadline-based timer model.
- `workouts/` — JSON workout collections loaded automatically.
- `workouts-manifest.json` — generated file list for hosts without directory listings.
- `scripts/update_workout_manifest.py` — refreshes the manifest after files are added, removed, or renamed.
- `icon.svg` — local favicon.
- `tests/test_app.py` — browser integration and deterministic timer checks.
- `tests/test_reorder.py` — mouse, touch, keyboard, and persistence checks for exercise reordering.
- `tests/test_folder_loading.py` — directory discovery, static-host fallback, saved-edit protection, and folder loading checks.

## Verification

The browser checks use Python and Playwright, with the app served on port 8000:

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tests/test_app.py
python3 tests/test_reorder.py
python3 tests/test_folder_loading.py
```

The test suite uses isolated browser contexts and does not modify the starter file or your browser's saved workouts. It checks timer boundaries, delayed updates, pause/resume, editing, deletion, persistence, JSON import/export, theme persistence, and mobile overflow.
