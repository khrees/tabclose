// Default inactivity limit in minutes
const DEFAULT_INACTIVITY_LIMIT_MINUTES = 360; // 6 hours

// Helper to check if a URL should be excluded
function shouldExclude(url, excludedDomains) {
    if (!url) return true; // Exclude tabs with no URL (e.g., new tab page)
    return excludedDomains.some((domain) => url.includes(domain));
}

// Update the last active time for a given tab (with proper locking)
function updateTabLastActive(tabId) {
    chrome.storage.local.get("tabLastActive", (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading storage:", chrome.runtime.lastError);
            return;
        }
        const tabLastActive = data.tabLastActive || {};
        tabLastActive[tabId] = Date.now();
        chrome.storage.local.set({ tabLastActive }, () => {
            if (chrome.runtime.lastError) {
                console.error("Error writing storage:", chrome.runtime.lastError);
            }
        });
    });
}

// Ensure alarm is always running
function ensureAlarmExists() {
    chrome.alarms.get("checkInactiveTabs", (alarm) => {
        if (!alarm) {
            console.log("Creating alarm for inactive tab checking");
            chrome.alarms.create("checkInactiveTabs", { periodInMinutes: 1 });
        }
    });
}

// Update scheduled cleanup alarm
function updateScheduledAlarm() {
    chrome.storage.local.get(["scheduledCleanupEnabled", "scheduledCleanupTime"], (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading scheduled settings:", chrome.runtime.lastError);
            return;
        }

        // Clear existing scheduled alarm
        chrome.alarms.clear("scheduledCleanup", () => {
            if (data.scheduledCleanupEnabled && data.scheduledCleanupTime) {
                const [hours, minutes] = data.scheduledCleanupTime.split(":").map(Number);
                const now = new Date();
                const scheduledTime = new Date();
                scheduledTime.setHours(hours, minutes, 0, 0);

                // If the time has passed today, schedule for tomorrow
                if (scheduledTime <= now) {
                    scheduledTime.setDate(scheduledTime.getDate() + 1);
                }

                const delayInMinutes = Math.round((scheduledTime - now) / (1000 * 60));

                chrome.alarms.create("scheduledCleanup", {
                    when: scheduledTime.getTime(),
                    periodInMinutes: 24 * 60 // Repeat daily
                });

                console.log(`Scheduled cleanup set for ${data.scheduledCleanupTime} (in ${delayInMinutes} minutes)`);
            } else {
                console.log("Scheduled cleanup disabled");
            }
        });
    });
}

// --- Event Listeners ---

// When a tab becomes active, update its timestamp
chrome.tabs.onActivated.addListener((activeInfo) => {
    updateTabLastActive(activeInfo.tabId);
});

// When a new tab is created, initialize its timestamp
chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id) {
        updateTabLastActive(tab.id);
    }
});

// When a tab is updated (e.g., reloaded or URL changes), update its timestamp
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // Update timestamp for important state changes
    if (changeInfo.status === "complete" || changeInfo.audible !== undefined) {
        updateTabLastActive(tabId);
    }
});

// When a tab is closed, remove its data
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.get("tabLastActive", (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading storage:", chrome.runtime.lastError);
            return;
        }
        const tabLastActive = data.tabLastActive || {};
        delete tabLastActive[tabId];
        chrome.storage.local.set({ tabLastActive }, () => {
            if (chrome.runtime.lastError) {
                console.error("Error writing storage:", chrome.runtime.lastError);
            }
        });
    });
});

// Function to close inactive tabs
function closeInactiveTabs(forceClose = false) {
    chrome.storage.local.get(
        ["globalEnabled", "tabLastActive", "excludedDomains", "inactivityLimit"],
        (data) => {
            if (chrome.runtime.lastError) {
                console.error("Error reading storage:", chrome.runtime.lastError);
                return;
            }

            // Check if globally enabled
            const globalEnabled = data.globalEnabled !== undefined ? data.globalEnabled : true;
            if (!globalEnabled) {
                console.log("TabClose is disabled, skipping cleanup");
                return;
            }

            const tabLastActive = data.tabLastActive || {};
            const excludedDomains = data.excludedDomains || [];
            const inactivityLimit =
                data.inactivityLimit || DEFAULT_INACTIVITY_LIMIT_MINUTES;
            const now = Date.now();

            chrome.tabs.query({ pinned: false, active: false }, (tabs) => {
                if (chrome.runtime.lastError) {
                    console.error("Error querying tabs:", chrome.runtime.lastError);
                    return;
                }

                let closedCount = 0;

                for (const tab of tabs) {
                    // Skip if no ID, excluded domain, or audible
                    if (!tab.id || shouldExclude(tab.url, excludedDomains) || tab.audible) {
                        continue;
                    }

                    const lastActive = tabLastActive[tab.id];
                    if (lastActive) {
                        const inactiveMinutes = (now - lastActive) / (1000 * 60);
                        // For scheduled cleanup, close if inactive for at least 1 minute
                        const threshold = forceClose ? 1 : inactivityLimit;

                        if (inactiveMinutes >= threshold) {
                            console.log(`Closing inactive tab: ${tab.title} (inactive for ${inactiveMinutes.toFixed(1)} minutes)`);
                            chrome.tabs.remove(tab.id, () => {
                                if (chrome.runtime.lastError) {
                                    console.error(`Error removing tab ${tab.id}:`, chrome.runtime.lastError);
                                } else {
                                    closedCount++;
                                }
                            });
                        }
                    } else {
                        // Tab has no timestamp - initialize it now
                        console.log(`Tab ${tab.id} has no timestamp, initializing`);
                        updateTabLastActive(tab.id);
                    }
                }

                if (forceClose && closedCount > 0) {
                    console.log(`Scheduled cleanup: closed ${closedCount} inactive tabs`);
                }
            });
        }
    );
}

// Update alarms based on close mode
function updateAlarmsForMode() {
    chrome.storage.local.get(["closeMode", "globalEnabled"], (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading close mode:", chrome.runtime.lastError);
            return;
        }

        const closeMode = data.closeMode || "inactivity";
        const globalEnabled = data.globalEnabled !== undefined ? data.globalEnabled : true;

        if (!globalEnabled) {
            console.log("TabClose disabled, clearing all alarms");
            chrome.alarms.clear("checkInactiveTabs");
            chrome.alarms.clear("scheduledCleanup");
            return;
        }

        if (closeMode === "scheduled") {
            // Disable continuous checking, enable scheduled
            chrome.alarms.clear("checkInactiveTabs");
            updateScheduledAlarm();
            console.log("Switched to scheduled mode");
        } else {
            // Enable continuous checking, disable scheduled
            chrome.alarms.clear("scheduledCleanup");
            ensureAlarmExists();
            console.log("Switched to inactivity timer mode");
        }
    });
}

// Alarm listener to check for inactive tabs
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "checkInactiveTabs") {
        closeInactiveTabs(false);
    } else if (alarm.name === "scheduledCleanup") {
        console.log("Running scheduled cleanup");
        closeInactiveTabs(true);
    }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "updateScheduledAlarm") {
        updateScheduledAlarm();
        sendResponse({ success: true });
    } else if (message.action === "updateCloseMode") {
        updateAlarmsForMode();
        sendResponse({ success: true });
    } else if (message.action === "updateGlobalState") {
        updateAlarmsForMode();
        sendResponse({ success: true });
    }
    return true;
});

// --- Extension Initialization ---

// Called when service worker starts up (handles restarts)
chrome.runtime.onStartup.addListener(() => {
    console.log("Service worker started, updating alarms based on mode");
    updateAlarmsForMode();
});

// Called when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
    console.log("Extension installed/updated");

    // Initialize storage with default values if they don't exist
    chrome.storage.local.get(null, (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading storage:", chrome.runtime.lastError);
            return;
        }

        const updates = {};

        if (data.globalEnabled === undefined) {
            updates.globalEnabled = true;
        }
        if (data.closeMode === undefined) {
            updates.closeMode = "inactivity";
        }
        if (data.tabLastActive === undefined) {
            updates.tabLastActive = {};
        }
        if (data.inactivityLimit === undefined) {
            updates.inactivityLimit = DEFAULT_INACTIVITY_LIMIT_MINUTES;
        }
        if (data.scheduledCleanupTime === undefined) {
            updates.scheduledCleanupTime = "21:00";
        }
        if (data.excludedDomains === undefined) {
            updates.excludedDomains = [
                "youtube.com",
                "gmail.com",
                "calendar.google.com",
                "protonmail.com",
                "netflix.com",
                "spotify.com",
            ];
        }

        if (Object.keys(updates).length > 0) {
            chrome.storage.local.set(updates, () => {
                if (chrome.runtime.lastError) {
                    console.error("Error initializing storage:", chrome.runtime.lastError);
                } else {
                    console.log("Storage initialized with defaults");
                    updateAlarmsForMode();
                }
            });
        } else {
            updateAlarmsForMode();
        }
    });

    // Set initial active time for all existing tabs
    chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError) {
            console.error("Error querying tabs:", chrome.runtime.lastError);
            return;
        }

        const initialTabLastActive = {};
        const now = Date.now();
        for (const tab of tabs) {
            if (tab.id) {
                initialTabLastActive[tab.id] = now;
            }
        }

        chrome.storage.local.set({ tabLastActive: initialTabLastActive }, () => {
            if (chrome.runtime.lastError) {
                console.error("Error setting initial timestamps:", chrome.runtime.lastError);
            } else {
                console.log(`Initialized timestamps for ${Object.keys(initialTabLastActive).length} tabs`);
            }
        });
    });
});

// Ensure alarms exist when service worker loads
updateAlarmsForMode();
