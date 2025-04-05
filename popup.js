const domainList = document.getElementById("domain-list");
const newDomainInput = document.getElementById("new-domain");
const addButton = document.getElementById("add-domain");

function renderList(domains) {
    domainList.innerHTML = "";
    domains.forEach((domain, index) => {
        const li = document.createElement("li");
        li.textContent = domain;

        const removeBtn = document.createElement("button");
        removeBtn.textContent = "✕";
        removeBtn.onclick = () => {
            domains.splice(index, 1);
            chrome.storage.local.set({ excludedDomains: domains }, () =>
                renderList(domains)
            );
        };

        li.appendChild(removeBtn);
        domainList.appendChild(li);
    });
}

chrome.storage.local.get("excludedDomains", (data) => {
    renderList(data.excludedDomains || []);
});

addButton.onclick = () => {
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
};
