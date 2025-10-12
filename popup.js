const inactivityLimitInput = document.getElementById("inactivity-limit");
const domainList = document.getElementById("domain-list");
const newDomainInput = document.getElementById("new-domain");
const addButton = document.getElementById("add-domain");

// --- Inactivity Limit --- //

function saveInactivityLimit() {
    const limit = parseInt(inactivityLimitInput.value, 10);
    if (limit > 0) {
        chrome.storage.local.set({ inactivityLimit: limit });
    }
}

inactivityLimitInput.addEventListener("change", saveInactivityLimit);

// --- Excluded Domains --- //

function renderList(domains) {
    domainList.innerHTML = "";
    domains.forEach((domain, index) => {
        const li = document.createElement("li");

        const span = document.createElement("span");
        span.textContent = domain;

        const removeBtn = document.createElement("button");
        removeBtn.textContent = "✕";
        removeBtn.onclick = () => {
            domains.splice(index, 1);
            chrome.storage.local.set({ excludedDomains: domains }, () => {
                renderList(domains);
            });
        };

        li.appendChild(span);
        li.appendChild(removeBtn);
        domainList.appendChild(li);
    });
}

function addDomain() {
    const domain = newDomainInput.value.trim();
    if (!domain) return;

    chrome.storage.local.get("excludedDomains", (data) => {
        const domains = data.excludedDomains || [];
        if (!domains.includes(domain)) {
            domains.push(domain);
            chrome.storage.local.set({ excludedDomains: domains }, () => {
                newDomainInput.value = "";
                renderList(domains);
            });
        }
    });
}

addButton.onclick = addDomain;
newDomainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        addDomain();
    }
});

// --- Initialization --- //

document.addEventListener("DOMContentLoaded", () => {
    chrome.storage.local.get(["inactivityLimit", "excludedDomains"], (data) => {
        inactivityLimitInput.value =
            data.inactivityLimit || 360; // Default to 6 hours
        renderList(data.excludedDomains || []);
    });
});
