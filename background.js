// Default inactivity limit in minutes
const DEFAULT_INACTIVITY_LIMIT_MINUTES = 360; // 6 hours
const TAB_ACTIVE_PREFIX = "tabActive_";
const CLOSED_TABS_PREFIX = "closedTab_";
const CLOSED_TABS_LIST = "closedTabsList";
const CLOSED_TABS_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

// Helper to check if a URL should be excluded.
// Uses proper domain-boundary matching to avoid false positives.
function shouldExclude(url, excludedDomains) {
    if (!url) return true; // Exclude tabs with no URL (e.g., new tab page)
    if (!excludedDomains || excludedDomains.length === 0) return false;

    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace(/^www\./i, "");
        return excludedDomains.some((domain) => {
            // Exact match or subdomain match with proper boundary
            return hostname === domain || hostname.endsWith("." + domain);
        });
    } catch {
        // Non-parseable URLs (about:, data:, blob:) — don't exclude by domain
        return false;
    }
}

// Store a closed tab in localStorage
function storeClosedTab(tabId, tabTitle, tabUrl, closeTime) {
    if (!tabUrl) return; // Don't store tabs without URLs

    const closedTab = {
        id: tabId,
        title: tabTitle || "New Tab",
        url: tabUrl,
        closedAt: closeTime || Date.now(),
    };

    const key = `${CLOSED_TABS_PREFIX}${tabId}_${closeTime || Date.now()}`;

    // Store the closed tab
    chrome.storage.local.set({ [key]: closedTab }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error storing closed tab:", chrome.runtime.lastError);
        }
    });

    // Update the list of closed tabs
    chrome.storage.local.get([CLOSED_TABS_LIST], (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading closed tabs list:", chrome.runtime.lastError);
            return;
        }

        const closedTabsList = data[CLOSED_TABS_LIST] || [];
        closedTabsList.push(key);

        // Keep only the most recent 100 entries to avoid storage bloat
        const truncatedList = closedTabsList.slice(-100);

        chrome.storage.local.set({ [CLOSED_TABS_LIST]: truncatedList }, () => {
            if (chrome.runtime.lastError) {
                console.error("Error updating closed tabs list:", chrome.runtime.lastError);
            }
        });
    });
}

// Clean up closed tabs older than 12 hours
function cleanupOldClosedTabs() {
    const now = Date.now();
    const cutoffTime = now - CLOSED_TABS_TTL_MS;

    chrome.storage.local.get([CLOSED_TABS_LIST], (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading closed tabs list for cleanup:", chrome.runtime.lastError);
            return;
        }

        const closedTabsList = data[CLOSED_TABS_LIST] || [];

        if (closedTabsList.length === 0) {
            return;
        }

        const keysToRemove = [];
        const keysToKeep = [];

        // Check each entry's timestamp
        for (const key of closedTabsList) {
            // Extract timestamp from key format: "closedTab_<tabId>_<timestamp>"
            const parts = key.split("_");
            const timestamp = parseInt(parts[parts.length - 1], 10);

            if (isNaN(timestamp) || timestamp < cutoffTime) {
                keysToRemove.push(key);
            } else {
                keysToKeep.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            // Remove old entries from storage
            chrome.storage.local.remove(keysToRemove, () => {
                if (chrome.runtime.lastError) {
                    console.error("Error removing old closed tabs:", chrome.runtime.lastError);
                } else {
                    console.log(`Cleaned up ${keysToRemove.length} old closed tab entries`);
                }
            });

            // Update the list to keep only recent entries
            chrome.storage.local.set({ [CLOSED_TABS_LIST]: keysToKeep }, () => {
                if (chrome.runtime.lastError) {
                    console.error("Error updating closed tabs list after cleanup:", chrome.runtime.lastError);
                }
            });
        }
    });
}

// Update the last active time for a given tab.
// Uses individual per-tab keys in chrome.storage.session so there is
// no read-modify-write race — each write is fully independent.
function updateTabLastActive(tabId) {
    chrome.storage.session.set({ [`${TAB_ACTIVE_PREFIX}${tabId}`]: Date.now() }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error writing session storage:", chrome.runtime.lastError);
        }
    });
}

// Cache a tab's URL and title in session storage so we have it when it closes
const TAB_INFO_PREFIX = "tabInfo_";
function cacheTabInfo(tabId, title, url) {
    if (!tabId || !url) return;
    chrome.storage.session.set({
        [`${TAB_INFO_PREFIX}${tabId}`]: { title: title || "New Tab", url: url }
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error caching tab info:", chrome.runtime.lastError);
        }
    });
}

// Ensure the inactivity-check alarm exists (called only in inactivity mode)
function ensureAlarmExists() {
    chrome.alarms.get("checkInactiveTabs", (alarm) => {
        if (!alarm) {
            console.log("Creating alarm for inactive tab checking");
            chrome.alarms.create("checkInactiveTabs", { periodInMinutes: 1 });
        }
    });
}

// Update — or create — the scheduled daily-cleanup alarm
function updateScheduledAlarm() {
    chrome.storage.local.get(["scheduledCleanupTime"], (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading scheduled settings:", chrome.runtime.lastError);
            return;
        }

        chrome.alarms.clear("scheduledCleanup", () => {
            if (data.scheduledCleanupTime) {
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
                    periodInMinutes: 24 * 60, // Repeat daily
                });

                console.log(
                    `Scheduled cleanup set for ${data.scheduledCleanupTime} (in ${delayInMinutes} minutes)`
                );
            } else {
                console.log("Scheduled cleanup: no time set");
            }
        });

        // Schedule cleanup of old closed tabs (runs daily, 1 hour after scheduled cleanup)
        chrome.alarms.clear("cleanupClosedTabs", () => {
            chrome.alarms.create("cleanupClosedTabs", {
                when: Date.now() + 60 * 60 * 1000, // 1 hour from now for first run
                periodInMinutes: 24 * 60, // Repeat daily
            });
            console.log("Scheduled closed tabs cleanup (hourly checks)");
        });
    });
}

// --- Event Listeners ---

// When a tab becomes active, update its timestamp
chrome.tabs.onActivated.addListener((activeInfo) => {
    updateTabLastActive(activeInfo.tabId);
});

// When a new tab is created, initialize its timestamp and cache its info
chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id) {
        updateTabLastActive(tab.id);
        cacheTabInfo(tab.id, tab.title, tab.url);
    }
});

// When a tab is updated (e.g., reloaded or URL changes), update its timestamp and cache info
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete" || changeInfo.audible !== undefined) {
        updateTabLastActive(tabId);
        // Cache tab info when page finishes loading (title is finalized)
        if (changeInfo.status === "complete") {
            chrome.tabs.get(tabId, (tab) => {
                if (!chrome.runtime.lastError && tab) {
                    cacheTabInfo(tabId, tab.title, tab.url);
                }
            });
        }
    }
    if (changeInfo.url || changeInfo.title) {
        // URL or title changed mid-load — cache the latest info
        chrome.tabs.get(tabId, (tab) => {
            if (!chrome.runtime.lastError && tab) {
                cacheTabInfo(tabId, tab.title, tab.url);
            }
        });
    }
});

// When a tab is closed, remove its session data and store it in closed tabs
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    // Look up cached tab info from session storage
    chrome.storage.session.get(`${TAB_INFO_PREFIX}${tabId}`, (sessionData) => {
        const tabInfo = sessionData[`${TAB_INFO_PREFIX}${tabId}`];

        if (tabInfo && tabInfo.url && !tabInfo.url.startsWith("chrome://") && !tabInfo.url.startsWith("about:")) {
            storeClosedTab(tabId, tabInfo.title, tabInfo.url, Date.now());
        }

        // Clean up session storage for this tab
        chrome.storage.session.remove([`${TAB_ACTIVE_PREFIX}${tabId}`, `${TAB_INFO_PREFIX}${tabId}`], () => {
            if (chrome.runtime.lastError) {
                console.error("Error removing from session storage:", chrome.runtime.lastError);
            }
        });
    });
});

// --- Core logic ---

// Close tabs that have been inactive past the configured threshold.
// forceClose=true lowers the threshold to 1 minute (used by scheduled cleanup
// and the manual "Close Now" button).
function closeInactiveTabs(forceClose = false) {
    chrome.storage.local.get(
        ["globalEnabled", "excludedDomains", "inactivityLimit", "closeMode"],
        (data) => {
            if (chrome.runtime.lastError) {
                console.error("Error reading storage:", chrome.runtime.lastError);
                return;
            }

            const globalEnabled = data.globalEnabled !== undefined ? data.globalEnabled : true;
            if (!globalEnabled) {
                console.log("TabClose is disabled, skipping cleanup");
                return;
            }

            const closeMode = data.closeMode || "inactivity";

            // The periodic check (checkInactiveTabs alarm, forceClose=false) is only
            // valid in inactivity mode.  A stale alarm that survived a mode switch
            // or a service-worker restart must not close tabs in scheduled mode.
            if (!forceClose && closeMode !== "inactivity") {
                console.log(
                    "Stale checkInactiveTabs alarm in",
                    closeMode,
                    "mode — clearing"
                );
                chrome.alarms.clear("checkInactiveTabs");
                return;
            }

            const excludedDomains = data.excludedDomains || [];
            const inactivityLimit = data.inactivityLimit || DEFAULT_INACTIVITY_LIMIT_MINUTES;
            const now = Date.now();

            // Read tab timestamps from session storage (in-memory, per-tab keys)
            chrome.storage.session.get(null, (sessionData) => {
                if (chrome.runtime.lastError) {
                    console.error("Error reading session storage:", chrome.runtime.lastError);
                    return;
                }

                // Rebuild the tab last-active map from individual session keys
                const tabLastActive = {};
                for (const [key, value] of Object.entries(sessionData || {})) {
                    if (key.startsWith(TAB_ACTIVE_PREFIX)) {
                        const tabId = parseInt(key.slice(TAB_ACTIVE_PREFIX.length), 10);
                        tabLastActive[tabId] = value;
                    }
                }

                chrome.tabs.query({ pinned: false, active: false }, (tabs) => {
                    if (chrome.runtime.lastError) {
                        console.error("Error querying tabs:", chrome.runtime.lastError);
                        return;
                    }

                    const tabsToRemove = [];

                    for (const tab of tabs) {
                        // Never close: tabs with no ID, from excluded domains, or playing audio
                        if (!tab.id || shouldExclude(tab.url, excludedDomains) || tab.audible) {
                            continue;
                        }

                        const lastActive = tabLastActive[tab.id];
                        if (lastActive) {
                            const inactiveMinutes = (now - lastActive) / (1000 * 60);
                            const threshold = forceClose ? 1 : inactivityLimit;

                            if (inactiveMinutes >= threshold) {
                                console.log(
                                    `Closing inactive tab: ${tab.title} (inactive for ${inactiveMinutes.toFixed(1)} minutes)`
                                );
                                tabsToRemove.push(tab.id);
                            }
                        } else {
                            // Tab has no timestamp yet — initialize it now
                            console.log(`Tab ${tab.id} has no timestamp, initializing`);
                            updateTabLastActive(tab.id);
                        }
                    }

                    if (tabsToRemove.length > 0) {
                        // Batch remove all qualifying tabs at once
                        chrome.tabs.remove(tabsToRemove, () => {
                            if (chrome.runtime.lastError) {
                                console.error("Error removing tabs:", chrome.runtime.lastError);
                            } else if (forceClose) {
                                console.log(
                                    `Scheduled cleanup: closed ${tabsToRemove.length} inactive tabs`
                                );
                            }
                        });
                    }
                });
            });
        }
    );
}

// Reconcile alarms with the current close mode and global toggle state
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
            chrome.alarms.clear("cleanupClosedTabs");
            chrome.action.setBadgeText({ text: "" });
            chrome.action.setBadgeBackgroundColor({ color: "#666" });
            return;
        }

        if (closeMode === "scheduled") {
            chrome.alarms.clear("checkInactiveTabs");
            updateScheduledAlarm();
            console.log("Switched to scheduled mode");
            chrome.action.setBadgeText({ text: "SCHED" });
            chrome.action.setBadgeBackgroundColor({ color: "#4ade80" });
        } else {
            chrome.alarms.clear("scheduledCleanup");
            ensureAlarmExists();
            // Also ensure cleanup alarm exists for inactivity mode
            chrome.alarms.get("cleanupClosedTabs", (alarm) => {
                if (!alarm) {
                    chrome.alarms.create("cleanupClosedTabs", {
                        when: Date.now() + 60 * 60 * 1000, // 1 hour from now
                        periodInMinutes: 24 * 60, // Repeat daily
                    });
                    console.log("Created cleanupClosedTabs alarm for inactivity mode");
                }
            });
            console.log("Switched to inactivity timer mode");
            chrome.action.setBadgeText({ text: "ON" });
            chrome.action.setBadgeBackgroundColor({ color: "#4ade80" });
        }
    });
}

// --- Alarms ---

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "checkInactiveTabs") {
        closeInactiveTabs(false);
    } else if (alarm.name === "scheduledCleanup") {
        console.log("Running scheduled cleanup");
        closeInactiveTabs(true);
    } else if (alarm.name === "cleanupClosedTabs") {
        console.log("Running cleanup of old closed tabs");
        cleanupOldClosedTabs();
    }
});

// --- Messages from popup ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.action) {
        case "updateScheduledAlarm":
            updateScheduledAlarm();
            sendResponse({ success: true });
            break;
        case "updateCloseMode":
            updateAlarmsForMode();
            sendResponse({ success: true });
            break;
        case "updateGlobalState":
            updateAlarmsForMode();
            sendResponse({ success: true });
            break;
        case "closeNow":
            closeInactiveTabs(true);
            sendResponse({ success: true });
            break;
        case "getClosedTabs":
            getClosedTabs(
                (tabs) => sendResponse({ tabs: tabs }),
                () => sendResponse({ error: "Failed to retrieve closed tabs" })
            );
            return true; // Keep channel open for async sendResponse
        case "clearClosedTabs":
            clearClosedTabs(() => sendResponse({ success: true }));
            return true; // Keep channel open for async sendResponse
    }
    return true; // Keep channel open for async sendResponse
});

// Retrieve all closed tabs stored in localStorage
function getClosedTabs(successCallback, errorCallback) {
    chrome.storage.local.get(null, (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading storage:", chrome.runtime.lastError);
            errorCallback(chrome.runtime.lastError);
            return;
        }

        const now = Date.now();
        const cutoffTime = now - CLOSED_TABS_TTL_MS;
        const closedTabs = [];

        // Get the list of closed tab keys
        const closedTabsList = data[CLOSED_TABS_LIST] || [];

        for (const key of closedTabsList) {
            // Extract timestamp from key format: "closedTab_<tabId>_<timestamp>"
            const parts = key.split("_");
            const timestamp = parseInt(parts[parts.length - 1], 10);

            // Skip old entries (shouldn't happen if cleanup is working, but just in case)
            if (isNaN(timestamp) || timestamp < cutoffTime) {
                continue;
            }

            // Get the closed tab data
            const closedTab = data[key];
            if (closedTab) {
                closedTabs.push(closedTab);
            }
        }

        // Sort by closedAt time (most recent first)
        closedTabs.sort((a, b) => b.closedAt - a.closedAt);

        successCallback(closedTabs);
    });
}

// Clear all closed tabs from localStorage
function clearClosedTabs(callback) {
    chrome.storage.local.get([CLOSED_TABS_LIST], (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading closed tabs list:", chrome.runtime.lastError);
            callback();
            return;
        }

        const closedTabsList = data[CLOSED_TABS_LIST] || [];

        if (closedTabsList.length === 0) {
            callback();
            return;
        }

        // Remove all closed tab entries
        chrome.storage.local.remove([...closedTabsList, CLOSED_TABS_LIST], () => {
            if (chrome.runtime.lastError) {
                console.error("Error clearing closed tabs:", chrome.runtime.lastError);
            } else {
                console.log(`Cleared ${closedTabsList.length} closed tab entries`);
            }
            callback();
        });
    });
}

// --- Startup & Install ---

// When the service worker starts after being idle (session storage persists)
chrome.runtime.onStartup.addListener(() => {
    console.log("Chrome started, updating alarms");
    updateAlarmsForMode();
    // Clean up old closed tabs on startup
    cleanupOldClosedTabs();
});

// On install or update (details.reason is "install" or "update")
chrome.runtime.onInstalled.addListener((details) => {
    console.log("Extension installed/updated, reason:", details.reason);

    chrome.storage.local.get(null, (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading storage:", chrome.runtime.lastError);
            return;
        }

        const updates = {};

        if (data.globalEnabled === undefined) updates.globalEnabled = true;
        if (data.closeMode === undefined) updates.closeMode = "inactivity";
        if (data.inactivityLimit === undefined) updates.inactivityLimit = DEFAULT_INACTIVITY_LIMIT_MINUTES;
        if (data.scheduledCleanupTime === undefined) updates.scheduledCleanupTime = "21:00";
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
        if (data.closedTabsList === undefined) updates.closedTabsList = [];

        if (Object.keys(updates).length > 0) {
            chrome.storage.local.set(updates, () => {
                if (chrome.runtime.lastError) {
                    console.error("Error initializing storage:", chrome.runtime.lastError);
                } else {
                    console.log("Storage initialized with defaults");
                }
            });
        }

        // Always ensure alarms reflect the current mode
        updateAlarmsForMode();
    });

    // Only reset tab timestamps on *first install*, never on update.
    // Doing so on update would reset every tab's inactivity clock to zero,
    // effectively disabling the extension for another full inactivity period.
    if (details.reason === "install") {
        chrome.tabs.query({}, (tabs) => {
            if (chrome.runtime.lastError) {
                console.error("Error querying tabs:", chrome.runtime.lastError);
                return;
            }

            const sessionData = {};
            const now = Date.now();
            for (const tab of tabs) {
                if (tab.id) {
                    sessionData[`${TAB_ACTIVE_PREFIX}${tab.id}`] = now;
                }
            }

            if (Object.keys(sessionData).length > 0) {
                chrome.storage.session.set(sessionData, () => {
                    if (chrome.runtime.lastError) {
                        console.error("Error setting initial timestamps:", chrome.runtime.lastError);
                    } else {
                        console.log(
                            `Initialized timestamps for ${Object.keys(sessionData).length} tabs`
                        );
                    }
                });
            }
        });
    }
});

// --- Service worker initialisation ---

// Session storage survives service-worker restarts (but not browser restarts).
// On a mid-session restart, any tabs that appeared while the worker was
// terminated may not have session entries yet — discover and backfill them.
function initializeSessionData() {
    chrome.storage.session.get(null, (sessionData) => {
        if (chrome.runtime.lastError) {
            console.error("Error reading session storage:", chrome.runtime.lastError);
            return;
        }

        const trackedTabIds = new Set();
        for (const key of Object.keys(sessionData || {})) {
            if (key.startsWith(TAB_ACTIVE_PREFIX)) {
                trackedTabIds.add(parseInt(key.slice(TAB_ACTIVE_PREFIX.length), 10));
            }
        }

        chrome.tabs.query({}, (tabs) => {
            if (chrome.runtime.lastError) {
                console.error("Error querying tabs:", chrome.runtime.lastError);
                return;
            }

            const now = Date.now();
            const sessionUpdates = {};
            for (const tab of tabs) {
                if (tab.id && !trackedTabIds.has(tab.id)) {
                    sessionUpdates[`${TAB_ACTIVE_PREFIX}${tab.id}`] = now;
                    // Also cache tab info for untracked tabs
                    if (tab.url) {
                        sessionUpdates[`${TAB_INFO_PREFIX}${tab.id}`] = { title: tab.title || "New Tab", url: tab.url };
                    }
                }
            }

            if (Object.keys(sessionUpdates).length > 0) {
                chrome.storage.session.set(sessionUpdates, () => {
                    if (chrome.runtime.lastError) {
                        console.error("Error initializing session storage:", chrome.runtime.lastError);
                    } else {
                        console.log(`Initialized ${Object.keys(sessionUpdates).length} untracked tabs`);
                    }
                });
            }
        });
    });
}

console.log("TabClose service worker started");
initializeSessionData();
updateAlarmsForMode();
