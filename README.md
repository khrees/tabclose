# TabClose

Automatically close inactive browser tabs. Choose between an inactivity timer or a daily scheduled cleanup.

## Features

- **Inactivity Timer** — closes tabs that haven't been used for a set period (default: 6 hours), checked every minute
- **Scheduled Cleanup** — closes inactive tabs once a day at a chosen time
- **Domain Exclusions** — tabs from specified domains are never auto-closed
- **Smart Protection** — pinned tabs, the active tab, and tabs playing audio are always preserved
- **Global Toggle** — turn the extension on and off from the popup

## How It Works

When a tab is activated, created, or finishes loading, its last-active timestamp is recorded.  Every minute the extension checks all non-pinned, non-active tabs and closes any that have been inactive past the configured limit.  In scheduled mode this check runs once daily at the set time instead.

Tab timestamps are kept in `chrome.storage.session` (in-memory, per-session), so stale data from past browser sessions never accumulates.

## Privacy

All data stays in your browser — no external servers, no tracking, no analytics.

## Project Structure

```
tabclose/
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker — alarms, tab tracking, close logic
├── popup.html         # Extension popup interface
├── popup.js           # Popup logic — settings, domain list, mode switching
├── style.css          # Popup styling
├── welcome.html       # About page
└── package.sh         # Release packaging script
```

## License

MIT
