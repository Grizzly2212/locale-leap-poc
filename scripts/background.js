const tabStateMap = new Map();

// --- CORE REDIRECTION LOGIC ---

// Simplified reachability check for the PoC
async function isUrlReachable(url) {
    try {
        const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
        // Treat redirects (3xx) and success (2xx) as reachable. 405 is common for HEAD requests.
        return response.status < 400 || response.status === 405;
    } catch (error) {
        // Network errors, timeouts, or CORS issues will be caught here
        console.warn(`Reachability check failed for ${url}:`, error.message);
        return false;
    }
}

// Generates candidate URLs based on patterns
function generateCandidateUrls(currentUrl, locale) {
    const candidates = new Set();
    const url = new URL(currentUrl);

    // 1. Subdomain: en.example.com -> fr.example.com
    const domainParts = url.hostname.split('.');
    if (domainParts.length > 1 && /^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/.test(domainParts[0])) {
        const newHostname = `${locale}.${domainParts.slice(1).join('.')}`;
        candidates.add(`https://${newHostname}${url.pathname}${url.search}`);
    }

    // 2. Path: example.com/en/page -> example.com/fr/page
    const pathSegments = url.pathname.split('/').filter(Boolean);
    if (pathSegments.length > 0 && /^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/.test(pathSegments[0])) {
        const newPath = `/${locale}/${pathSegments.slice(1).join('/')}`;
        candidates.add(`${url.origin}${newPath}${url.search}`);
    } else {
        // Or example.com/page -> example.com/fr/page
        const newPath = `/${locale}${url.pathname}`;
        candidates.add(`${url.origin}${newPath}${url.search}`);
    }

    return Array.from(candidates).map(urlStr => ({
        url: urlStr,
        locale: locale,
        producer: 'PATTERN_SIBLING'
    }));
}

async function attemptNextRedirect(tabId) {
    const status = tabStateMap.get(tabId);
    if (!status || status.handled || status.attempting) return;

    status.attempting = true;

    while (status.queue.length > 0) {
        const candidate = status.queue.shift(); // Get highest priority

        if (status.tried.has(candidate.url) || candidate.url === status.url) {
            continue;
        }
        status.tried.add(candidate.url);

        if (await isUrlReachable(candidate.url)) {
            console.log(`Found reachable candidate: ${candidate.url}. Redirecting...`);
            status.handled = true;
            status.attempting = false;
            chrome.tabs.update(tabId, { url: candidate.url });
            return; // Stop after the first successful redirect
        }
    }

    status.attempting = false;
    status.handled = true; // Mark as handled even if no redirect occurred
}

// --- EVENT LISTENERS ---

// Main entry point for navigation
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0 || !details.url.startsWith('http')) return;

    const { tabId, url } = details;
    const { preferredLocale, ignoredDomains = [] } = await chrome.storage.sync.get(['preferredLocale', 'ignoredDomains']);

    if (!preferredLocale) return;

    try {
        const domain = new URL(url).hostname;
        if (ignoredDomains.some(ignored => domain === ignored || domain.endsWith(`.${ignored}`))) {
            console.log(`Domain ${domain} is on the ignore list. Skipping.`);
            tabStateMap.delete(tabId);
            return;
        }

        // Initialize state for the new navigation
        tabStateMap.set(tabId, {
            url,
            handled: false,
            attempting: false,
            queue: generateCandidateUrls(url, preferredLocale),
            tried: new Set(),
        });

        console.log(`Tab ${tabId} navigating to ${url}. Initial candidates:`, tabStateMap.get(tabId).queue);

        // Start checking pattern-based candidates immediately
        attemptNextRedirect(tabId);

    } catch (e) {
        console.error(`Error processing navigation to ${url}:`, e);
    }
});

// Inject content script after the page has committed to loading
chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0 || !details.url.startsWith('http')) return;

    const status = tabStateMap.get(details.tabId);
    if (status && !status.handled) {
        chrome.scripting.executeScript({
            target: { tabId: details.tabId },
            files: ['scripts/content.js'],
        });
    }
});


// Listen for hreflang links from the content script
chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type === 'HREFLANG_DISCOVERED' && sender.tab?.id) {
        const tabId = sender.tab.id;
        const status = tabStateMap.get(tabId);

        if (status && !status.handled) {
            console.log(`Received hreflang candidates for tab ${tabId}:`, message.candidates);
            // Prepend hreflang candidates to the queue (they have higher priority)
            status.queue.unshift(...message.candidates);
            // Re-trigger the check process with the new high-priority candidates
            attemptNextRedirect(tabId);
        }
    }
});

// Clean up state when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    tabStateMap.delete(tabId);
});