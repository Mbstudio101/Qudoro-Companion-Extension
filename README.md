# Qudoro Companion Extension

Browser extension that creates Qudoro-compatible study exports for `Questions` + `Flashcards`.

## What It Does

- Build a set title/description.
- Add cards manually (front/back).
- Optional multiple-choice mode with options.
- Capture highlighted text from the active tab into front/back fields.
- Export JSON in Qudoro import format:
  - `questions: []`
  - `sets: []`

## Install (Chrome/Edge)

1. Open extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:
   - `extensions/qudoro-companion`

## Use With Qudoro App

1. Create cards in extension popup.
2. Click **Download Qudoro JSON**.
3. In Qudoro app:
   - `Settings -> Data -> Import Data`
4. Select the downloaded file.

The imported set will appear in question setup and be available in flashcards.

## Notes

- Exported cards are tagged `extension-import`.
- If multiple-choice is enabled, the back answer can be:
  - full answer text, or
  - label forms like `B`, `2`, `Answer: C`.
