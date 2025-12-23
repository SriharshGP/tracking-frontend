(function() {
    // ================= CONFIGURATION =================
    const CONFIG = {
        baseUrl: "http://localhost:5000", 
        userIdentity: "user@test.com", 
        batchSize: 5,
        flushInterval: 3000, // Increased slightly as data is now higher quality, less frequent
        throttleDelay: 500   // For scroll events
    };

    // ================= STATE =================
    let eventQueue = [];
    let sessionID = null;
    let isTrackingActive = false; 
    let milestones = new Set(); // To track 25%, 50%, etc.

    // ================= CONSENT MANAGER (Unchanged) =================
    async function initConsent() {
        console.log(`[Tracker] Checking consent for: ${CONFIG.userIdentity}...`);
        try {
            const response = await fetch(`${CONFIG.baseUrl}/check-consent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: CONFIG.userIdentity })
            });
            const data = await response.json();

            if (data.allowed === true) {
                console.log("[Tracker] Consent verified by Server.");
                startTracking();
            } else {
                if (localStorage.getItem('analytics_consent') === 'declined') {
                    console.log("[Tracker] User explicitly declined locally.");
                    return;
                }
                showConsentBanner();
            }
        } catch (err) {
            console.error("[Tracker] Backend offline. Falling back to local check.", err);
            if (localStorage.getItem('analytics_consent') === 'accepted') startTracking();
            else showConsentBanner();
        }
    }

    function showConsentBanner() {
        if (document.getElementById('analytics-consent-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'analytics-consent-banner';
        banner.style.cssText = `
            position: fixed; bottom: 0; left: 0; right: 0;
            background: #222; color: #fff; padding: 15px 20px;
            text-align: center; font-family: sans-serif; z-index: 9999;
            box-shadow: 0 -2px 10px rgba(0,0,0,0.2); border-top: 1px solid #444;
            display: flex; justify-content: center; align-items: center; gap: 20px;
        `;
        banner.innerHTML = `
            <span>We use cookies to improve your experience. Do you accept usage tracking?</span>
            <div>
                <button id="btn-decline" style="margin-right: 10px; padding: 8px 15px; background: transparent; color: #ccc; border: 1px solid #555; cursor: pointer;">Decline</button>
                <button id="btn-accept" style="padding: 8px 15px; background: #007bff; color: #fff; border: none; cursor: pointer; font-weight: bold;">Accept</button>
            </div>
        `;
        document.body.appendChild(banner);

        document.getElementById('btn-accept').addEventListener('click', () => {
            localStorage.setItem('analytics_consent', 'accepted'); 
            document.body.removeChild(banner);
            startTracking(); 
        });

        document.getElementById('btn-decline').addEventListener('click', () => {
            localStorage.setItem('analytics_consent', 'declined');
            document.body.removeChild(banner);
        });
    }

    // ================= TRACKING CORE =================
    function startTracking() {
        if (isTrackingActive) return;
        isTrackingActive = true;
        console.log("[Tracker] Tracking Active 🟢");

        sessionID = getSessionId();

        // 1. Track Page View (Contextual Data)
        trackPageView();

        // 2. Track Interactive Clicks (Buttons, Links)
        document.addEventListener('click', (e) => {
            if (e.target.closest('#analytics-consent-banner')) return;
            
            // Only track clicks on meaningful elements or elements with IDs/Classes
            const meaningfulTarget = e.target.closest('a, button, input, [role="button"]');
            
            if (meaningfulTarget || e.target.id || e.target.className) {
                const el = meaningfulTarget || e.target;
                trackEvent('interaction_click', {
                    tag: el.tagName,
                    id: el.id || null,
                    class: el.className || null,
                    text: (el.innerText || "").substring(0, 50), // First 50 chars only
                    href: el.href || null
                });
            }
        });

        // 3. Track Form Abandonment (Partial Fills)
        document.addEventListener('focusout', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                // EXCLUDE SENSITIVE FIELDS LIKE PASSWORD
                if (e.target.type === 'password') return; 

                if (e.target.value.length > 0) {
                     trackEvent('form_abandonment', {
                        field_id: e.target.id || e.target.name || 'unknown_input',
                        // In production, hash this value or flag it as sensitive!
                        value_length: e.target.value.length,
                        is_completed: false
                    });
                }
            }
        }, true);

        // 4. Track Scroll Depth (Milestones: 25%, 50%, 75%, 90%)
        window.addEventListener('scroll', throttle(() => {
            const scrollTop = window.scrollY;
            const docHeight = document.body.offsetHeight - window.innerHeight;
            const scrollPercent = Math.floor((scrollTop / docHeight) * 100);

            [25, 50, 75, 90].forEach(milestone => {
                if (scrollPercent >= milestone && !milestones.has(milestone)) {
                    milestones.add(milestone);
                    trackEvent('scroll_depth', { depth: milestone + '%' });
                }
            });
        }, CONFIG.throttleDelay));

        // Flush data periodically
        setInterval(sendData, CONFIG.flushInterval);
    }

    // ================= SPECIFIC TRACKERS =================
    function trackPageView() {
        // Capture Technical Context
        const perf = window.performance.getEntriesByType("navigation")[0] || {};
        
        trackEvent('page_view', {
            url: window.location.href,
            referrer: document.referrer || "direct",
            user_agent: navigator.userAgent,
            screen_width: window.innerWidth,
            load_time_ms: Math.round(perf.domContentLoadedEventEnd || 0)
        });
    }

    // ================= HELPER FUNCTIONS =================
    function getSessionId() {
        let id = localStorage.getItem('analytics_session_id');
        if (!id) {
            id = 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now();
            localStorage.setItem('analytics_session_id', id);
        }
        return id;
    }

    function throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }

    function trackEvent(type, data = {}) {
        // Generic structure for all events
        eventQueue.push({ 
            event_type: type, 
            timestamp: Date.now(), 
            page: window.location.pathname,
            ...data 
        });
        
        if (eventQueue.length >= CONFIG.batchSize) sendData();
    }

    function sendData() {
        if (eventQueue.length === 0) return;

        // Copy and clear queue immediately to prevent duplicates
        const payloadEvents = [...eventQueue];
        eventQueue = [];

        fetch(`${CONFIG.baseUrl}/api/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionID,
                email: CONFIG.userIdentity,
                // We now send a generic 'events' array containing different types
                events: payloadEvents 
            }),
            keepalive: true
        }).catch(err => {
            console.error("[Tracker] Send failed", err);
            // Optional: Restore failed events to queue?
            // eventQueue = [...payloadEvents, ...eventQueue]; 
        });
    }

    // ================= STARTUP =================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initConsent);
    } else {
        initConsent();
    }

})();