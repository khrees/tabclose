// Default inactivity limit in minutes
const DEFAULT_INACTIVITY_LIMIT_MINUTES = 360; // 6 hours

// Helper to check if a URL should be excluded
function shouldExclude(url, excludedDomains) {
    if (!url) return true; // Exclude tabs with no URL (e.g., new tab page)
    return excludedDomains.some((domain) => url.includes(domain));
}

// Update the last active time for a given tab
function updateTabLastActive(tabId) {
    chrome.storage.local.get("tabLastActive", (data) => {
        const tabLastActive = data.tabLastActive || {};
        tabLastActive[tabId] = Date.now();
        chrome.storage.local.set({ tabLastActive });
    });
}

// --- Event Listeners ---

// When a tab becomes active, update its timestamp
chrome.tabs.onActivated.addListener((activeInfo) => {
    updateTabLastActive(activeInfo.tabId);
});

// When a tab is closed, remove its data
// When a tab is updated (e.g., reloaded or URL changes), update its timestamp
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // We only care if the tab is not active, as onActivated covers active tabs
    if (tab.active) return;

    // Check for audible tabs or other important state changes if needed
    if (changeInfo.status === "complete" || changeInfo.audible) {
        updateTabLastActive(tabId);
    }
});

// When a tab is closed, remove its data
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.get("tabLastActive", (data) => {
        const tabLastActive = data.tabLastActive || {};
        delete tabLastActive[tabId];
        chrome.storage.local.set({ tabLastActive });
    });
});

// Alarm listener to check for inactive tabs
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "checkInactiveTabs") {
        chrome.storage.local.get(
            ["tabLastActive", "excludedDomains", "inactivityLimit"],
            (data) => {
                const tabLastActive = data.tabLastActive || {};
                const excludedDomains = data.excludedDomains || [];
                const inactivityLimit =
                    data.inactivityLimit || DEFAULT_INACTIVITY_LIMIT_MINUTES;
                const now = Date.now();

                chrome.tabs.query({ pinned: false, active: false }, (tabs) => {
                    for (const tab of tabs) {
                        if (!tab.id || shouldExclude(tab.url, excludedDomains)) {
                            continue;
                        }

                        const lastActive = tabLastActive[tab.id];
                        if (lastActive) {
                            const inactiveMinutes = (now - lastActive) / (1000 * 60);
                            if (inactiveMinutes >= inactivityLimit) {
                                chrome.tabs.remove(tab.id);
                            }
                        }
                    }
                });
            }
        );
    }
});

// --- Extension Initialization ---
chrome.runtime.onInstalled.addListener(() => {
    // Create the alarm
    chrome.alarms.create("checkInactiveTabs", { periodInMinutes: 1 });

    // Initialize storage with default values if they don't exist
    chrome.storage.local.get(null, (data) => {
        if (data.tabLastActive === undefined) {
            chrome.storage.local.set({ tabLastActive: {} });
        }
        if (data.inactivityLimit === undefined) {
            chrome.storage.local.set({
                inactivityLimit: DEFAULT_INACTIVITY_LIMIT_MINUTES,
            });
        }
        if (data.excludedDomains === undefined) {
            chrome.storage.local.set({
                excludedDomains: [
                    "youtube.com",
                    "gmail.com",
                    "calendar.google.com",
                    "protonmail.com",
                    "netflix.com",
                    "spotify.com",
                ],
            });
        }
    });

    // Set initial active time for all existing tabs
    chrome.tabs.query({}, (tabs) => {
        const initialTabLastActive = {};
        const now = Date.now();
        for (const tab of tabs) {
            if (tab.id) {
                initialTabLastActive[tab.id] = now;
            }
        }
        chrome.storage.local.set({ tabLastActive: initialTabLastActive });
    });
});
