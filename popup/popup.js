document.addEventListener('DOMContentLoaded', async () => {
    const localeInput = document.getElementById('locale-input');
    const saveButton = document.getElementById('save-button');
    const currentLocaleEl = document.getElementById('current-locale');
    const ignoreButton = document.getElementById('ignore-button');
    const ignoredListEl = document.getElementById('ignored-list');

    // Load and display current settings
    const { preferredLocale, ignoredDomains = [] } = await chrome.storage.sync.get(['preferredLocale', 'ignoredDomains']);
    if (preferredLocale) {
        currentLocaleEl.textContent = preferredLocale;
        localeInput.value = preferredLocale;
    }
    ignoredListEl.innerHTML = ignoredDomains.map(domain => `<li>${domain}</li>`).join('');

    // Save preferred locale
    saveButton.addEventListener('click', () => {
        const newLocale = localeInput.value.trim();
        if (newLocale) {
            chrome.storage.sync.set({ preferredLocale: newLocale }, () => {
                currentLocaleEl.textContent = newLocale;
                console.log('Preferred locale saved:', newLocale);
            });
        }
    });

    // Ignore current site
    ignoreButton.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
            try {
                const url = new URL(tab.url);
                const domain = url.hostname;
                const { ignoredDomains = [] } = await chrome.storage.sync.get('ignoredDomains');
                if (!ignoredDomains.includes(domain)) {
                    const newIgnoredDomains = [...ignoredDomains, domain];
                    await chrome.storage.sync.set({ ignoredDomains: newIgnoredDomains });
                    ignoredListEl.innerHTML += `<li>${domain}</li>`;
                    console.log('Ignored domain added:', domain);
                }
            } catch (e) {
                console.error("Could not parse URL to get domain:", tab.url);
            }
        }
    });
});