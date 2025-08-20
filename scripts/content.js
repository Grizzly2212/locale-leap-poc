// Ensure the script runs only once per page load
if (!window.hasRunLocaleLeapContentScript) {
    window.hasRunLocaleLeapContentScript = true;

    (async () => {
        const { preferredLocale } = await chrome.storage.sync.get('preferredLocale');
        if (!preferredLocale) return;

        const hreflangLinks = document.querySelectorAll('link[rel="alternate"][hreflang]');
        const candidates = [];

        hreflangLinks.forEach(link => {
            const lang = link.getAttribute('hreflang');
            // Prioritize an exact match for the user's preferred locale
            if (lang && lang.toLowerCase() === preferredLocale.toLowerCase()) {
                candidates.push({
                    url: link.href,
                    locale: lang,
                    producer: 'HREFLANG',
                });
            }
        });

        if (candidates.length > 0) {
            console.log('Content script found hreflang candidates:', candidates);
            chrome.runtime.sendMessage({
                type: 'HREFLANG_DISCOVERED',
                candidates: candidates,
            });
        }
    })();
}