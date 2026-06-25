const globalEnabledCheckbox = document.getElementById("global-enabled");
const statusText = document.getElementById("status-text");
const viewMode = document.getElementById("view-mode");
const editMode = document.getElementById("edit-mode");
const editBtn = document.getElementById("edit-btn");
const saveBtn = document.getElementById("save-btn");
const cancelBtn = document.getElementById("cancel-btn");
const inactivityLimitInput = document.getElementById("inactivity-limit");
const scheduledTimeInput = document.getElementById("scheduled-time");
const domainList = document.getElementById("domain-list");
const newDomainInput = document.getElementById("new-domain");
const addButton = document.getElementById("add-domain");
const tabButtons = document.querySelectorAll(".tab-button");
const tabContents = document.querySelectorAll(".tab-content");

// Store original values for cancel
let originalSettings = {};
let editingDomains = [];

// --- Mode Switching --- //

function showViewMode() {
    viewMode.style.display = "block";
    editMode.style.display = "none";
    updateViewDisplay();
}

function showEditMode() {
    chrome.storage.local.get("excludedDomains", (data) => {
        editingDomains = [...(data.excludedDomains || [])];
        renderList();
    });

    viewMode.style.display = "none";
    editMode.style.display = "block";
}

// --- Global Toggle --- //

function updateGlobalState() {
    const enabled = globalEnabledCheckbox.checked;
    statusText.textContent = enabled ? "ON" : "OFF";
    statusText.className = enabled ? "" : "off";

    if (enabled) {
        viewMode.style.opacity = "1";
        viewMode.style.pointerEvents = "auto";
    } else {
        viewMode.style.opacity = "0.4";
        viewMode.style.pointerEvents = "none";
    }

    chrome.storage.local.set({ globalEnabled: enabled }, () => {
        // Notify background script
        chrome.runtime.sendMessage({ action: "updateGlobalState" });
    });
}

globalEnabledCheckbox.addEventListener("change", updateGlobalState);

// --- Tabs --- //

function switchTab(targetTab, skipSave = true) {
    // Update tab buttons
    tabButtons.forEach(btn => {
        if (btn.dataset.tab === targetTab) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    // Update tab contents
    tabContents.forEach(content => {
        if (content.id === `${targetTab}-tab`) {
            content.classList.add("active");
        } else {
            content.classList.remove("active");
        }
    });

    // Only save if not skipping (for initial load)
    if (!skipSave) {
        const mode = targetTab === "scheduled" ? "scheduled" : "inactivity";
        chrome.storage.local.set({ closeMode: mode });
    }
}

tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        switchTab(btn.dataset.tab, true);
    });
});

// --- Save/Cancel Actions --- //

function saveSettings() {
    const closeMode = document.querySelector(".tab-button.active").dataset.tab === "scheduled" ? "scheduled" : "inactivity";
    const inactivityLimit = parseInt(inactivityLimitInput.value, 10);
    const scheduledTime = scheduledTimeInput.value;

    const settings = {
        closeMode: closeMode,
        inactivityLimit: inactivityLimit,
        scheduledCleanupTime: scheduledTime,
        excludedDomains: editingDomains
    };

    chrome.storage.local.set(settings, () => {
        // Notify background script
        chrome.runtime.sendMessage({ action: "updateCloseMode" });
        if (closeMode === "scheduled") {
            chrome.runtime.sendMessage({ action: "updateScheduledAlarm" });
        }

        // Show view mode
        showViewMode();
    });
}

function cancelEdit() {
    // Reload form with original values
    loadSettings();
    showViewMode();
}

editBtn.addEventListener("click", showEditMode);
saveBtn.addEventListener("click", saveSettings);
cancelBtn.addEventListener("click", cancelEdit);
document.getElementById("close-now-btn")?.addEventListener("click", () => {
    const btn = document.getElementById("close-now-btn");
    const originalText = btn.textContent;
    btn.textContent = "Closing…";
    btn.disabled = true;

    chrome.runtime.sendMessage({ action: "closeNow" }, () => {
        if (chrome.runtime.lastError) {
            btn.textContent = "Error!";
        } else {
            btn.textContent = "Done!";
        }
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 1500);
    });
});

// --- Excluded Domains --- //

function cleanDomain(input) {
    // Remove protocol (http://, https://, etc.)
    let domain = input.replace(/^https?:\/\//i, "");

    // Remove www. prefix
    domain = domain.replace(/^www\./i, "");

    // Remove trailing slashes and paths
    domain = domain.split("/")[0];

    // Remove port numbers
    domain = domain.split(":")[0];

    return domain.toLowerCase().trim();
}

function isValidDomain(domain) {
    // Check if empty
    if (!domain) return false;

    // Support localhost
    if (domain === "localhost") return true;

    // IPv4 pattern: 4 numbers separated by dots (0-255 each)
    const ipv4Pattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (ipv4Pattern.test(domain)) return true;

    // Domain regex pattern
    // Matches: example.com, sub.example.com, example.co.uk, etc.
    const domainPattern = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

    return domainPattern.test(domain);
}

function showDomainError(message) {
    newDomainInput.classList.add("error");
    newDomainInput.placeholder = message;

    setTimeout(() => {
        newDomainInput.classList.remove("error");
        newDomainInput.placeholder = "e.g. google.com or mail.google.com";
    }, 3000);
}

function renderList() {
    domainList.innerHTML = "";
    editingDomains.forEach((domain, index) => {
        const li = document.createElement("li");

        const span = document.createElement("span");
        span.textContent = domain;

        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove";
        removeBtn.className = "remove-button";
        removeBtn.onclick = () => {
            editingDomains.splice(index, 1);
            renderList();
        };

        li.appendChild(span);
        li.appendChild(removeBtn);
        domainList.appendChild(li);
    });
}

function addDomain() {
    const input = newDomainInput.value.trim();
    if (!input) return;

    // Clean the domain
    const domain = cleanDomain(input);

    // Validate the domain
    if (!isValidDomain(domain)) {
        showDomainError("Invalid domain format");
        return;
    }

    if (editingDomains.includes(domain)) {
        showDomainError("Domain already added");
        return;
    }

    editingDomains.push(domain);
    newDomainInput.value = "";
    renderList();
}

addButton.onclick = addDomain;
newDomainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        addDomain();
    }
});

// --- View Display Update --- //

function updateViewDisplay() {
    chrome.storage.local.get([
        "closeMode",
        "inactivityLimit",
        "scheduledCleanupTime",
        "excludedDomains"
    ], (data) => {
        const closeMode = data.closeMode || "inactivity";
        const inactivityLimit = data.inactivityLimit || 360;
        const scheduledTime = data.scheduledCleanupTime || "21:00";
        const domains = data.excludedDomains || [];

        // Update mode display
        document.getElementById("view-mode-text").textContent =
            closeMode === "scheduled" ? "Scheduled" : "Inactivity Timer";

        // Show/hide appropriate time display
        if (closeMode === "scheduled") {
            document.getElementById("view-inactivity-item").style.display = "none";
            document.getElementById("view-scheduled-item").style.display = "flex";
            document.getElementById("view-scheduled-text").textContent = scheduledTime;
        } else {
            document.getElementById("view-inactivity-item").style.display = "flex";
            document.getElementById("view-scheduled-item").style.display = "none";

            // Format time display
            const hours = Math.floor(inactivityLimit / 60);
            const minutes = inactivityLimit % 60;
            let timeText = "";
            if (hours > 0) {
                timeText += `${hours} hour${hours > 1 ? 's' : ''}`;
                if (minutes > 0) timeText += ` ${minutes} min`;
            } else {
                timeText = `${minutes} minute${minutes > 1 ? 's' : ''}`;
            }
            document.getElementById("view-inactivity-text").textContent = timeText;
        }

        // Update domains count
        const domainCount = domains.length;
        document.getElementById("view-domains-text").textContent =
            domainCount === 0 ? "None" :
            domainCount === 1 ? "1 domain" :
            `${domainCount} domains`;
    });
}

// --- Settings Load --- //

function loadSettings() {
    chrome.storage.local.get([
        "globalEnabled",
        "closeMode",
        "inactivityLimit",
        "excludedDomains",
        "scheduledCleanupTime"
    ], (data) => {
        // Global toggle
        const globalEnabled = data.globalEnabled !== undefined ? data.globalEnabled : true;
        globalEnabledCheckbox.checked = globalEnabled;
        statusText.textContent = globalEnabled ? "ON" : "OFF";
        statusText.className = globalEnabled ? "" : "off";

        if (globalEnabled) {
            viewMode.style.opacity = "1";
            viewMode.style.pointerEvents = "auto";
        } else {
            viewMode.style.opacity = "0.4";
            viewMode.style.pointerEvents = "none";
        }

        // Close mode tabs
        const closeMode = data.closeMode || "inactivity";
        const activeTab = closeMode === "scheduled" ? "scheduled" : "inactivity";
        switchTab(activeTab, true);

        // Settings values
        inactivityLimitInput.value = data.inactivityLimit || 360;
        scheduledTimeInput.value = data.scheduledCleanupTime || "21:00";

        editingDomains = [...(data.excludedDomains || [])];
        renderList();

        // Update view display
        updateViewDisplay();
    });
}

// --- Initialization --- //

document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    showViewMode();
});
