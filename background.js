const INACTIVITY_LIMIT_MINUTES = 360; // 6 hours

function shouldExclude(url, excludedDomains) {
    return excludedDomains.some((domain) => url.includes(domain));
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("checkInactiveTabs", { periodInMinutes: 1 });
    chrome.storage.local.set({ tabLastActive: {} });

    // Set default exclude list if none exists
    chrome.storage.local.get("excludedDomains", (data) => {
        if (!data.excludedDomains) {
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
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "checkInactiveTabs") {
        chrome.windows.getAll({ populate: true }, (windows) => {
            const now = Date.now();
            chrome.storage.local.get(
                ["tabLastActive", "excludedDomains"],
                (data) => {
                    const tabLastActive = data.tabLastActive || {};
                    const excludedDomains = data.excludedDomains || [];
                    for (const window of windows) {
                        for (const tab of window.tabs) {
                            if (!tab.id || !tab.url) continue;
                            if (shouldExclude(tab.url, excludedDomains))
                                continue;

                            if (!tab.active && !tab.pinned) {
                                const lastActive = tabLastActive[tab.id] || now;
                                const inactiveMinutes =
                                    (now - lastActive) / (1000 * 60);
                                if (
                                    inactiveMinutes >= INACTIVITY_LIMIT_MINUTES
                                ) {
                                    chrome.tabs.remove(tab.id);
                                    delete tabLastActive[tab.id];
                                }
                            } else if (tab.active) {
                                tabLastActive[tab.id] = now;
                            }
                        }
                    }
                    chrome.storage.local.set({ tabLastActive });
                }
            );
        });
    }
});
