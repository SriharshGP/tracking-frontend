(function() {
    // ================= CONFIGURATION =================
    const CONFIG = {
        endpoint: "https://google-ads-backend-tlvs.onrender.com", // REPLACE THIS with your server URL
        batchSize: 10,       // Send data after collecting 10 events
        flushInterval: 5000, // Or send every 5 seconds, whichever comes first
        throttleDelay: 100   // Only record mouse movement every 100ms
    };

    // ================= STATE MANAGEMENT =================
    let eventQueue = [];
    let sessionID = getSessionId();
    let throttleTimer = null;
    let flushTimer = null;

    // ================= HELPER FUNCTIONS =================
    
    // 1. Get or Create a unique Session ID (stored in browser cookies/storage)
    function getSessionId() {
        let id = localStorage.getItem('analytics_session_id');
        if (!id) {
            id = 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now();
            localStorage.setItem('analytics_session_id', id);
        }
        return id;
    }

    // 2. The Sender - Pushes data to your server
    function sendData() {
        if (eventQueue.length === 0) return;

        const payload = {
            session_id: sessionID,
            url: window.location.href,
            referrer: document.referrer,
            timestamp: Date.now(),
            user_agent: navigator.userAgent,
            events: eventQueue
        };

        // Use sendBeacon if available (more reliable for page unloads), else fall back to fetch
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        if (navigator.sendBeacon) {
            navigator.sendBeacon(CONFIG.endpoint, blob);
        } else {
            fetch(CONFIG.endpoint, {
                method: 'POST',
                body: JSON.stringify(payload),
                keepalive: true // Important for background sending
            }).catch(console.error);
        }

        // Clear the queue after sending
        eventQueue = [];
    }

    // 3. Queue Manager - Adds events to the list
    function trackEvent(type, data = {}) {
        eventQueue.push({
            type: type,
            timestamp: Date.now(),
            ...data
        });

        // If queue is full, send immediately
        if (eventQueue.length >= CONFIG.batchSize) {
            sendData();
        }
    }

    // ================= TRACKING LOGIC =================

    // A. Track Page View (Immediately on load)
    trackEvent('page_view', {
        width: window.innerWidth,
        height: window.innerHeight
    });

    // B. Track Clicks (Buttons, Links, etc.)
    document.addEventListener('click', (e) => {
        trackEvent('click', {
            x: e.clientX,
            y: e.clientY,
            target_tag: e.target.tagName,
            target_id: e.target.id || null,
            target_class: e.target.className || null,
            text_content: e.target.innerText ? e.target.innerText.substring(0, 50) : null
        });
    });

    // C. Track Mouse Movement (Throttled)
    document.addEventListener('mousemove', (e) => {
        const now = Date.now();
        if (throttleTimer && now < throttleTimer + CONFIG.throttleDelay) {
            return; // Skip this event if we are too fast
        }
        throttleTimer = now;

        trackEvent('mousemove', {
            x: e.clientX,
            y: e.clientY
        });
    });

    // D. Track Scroll Depth
    let maxScroll = 0;
    document.addEventListener('scroll', () => {
        const scrollPercent = Math.round((window.scrollY + window.innerHeight) / document.body.scrollHeight * 100);
        if (scrollPercent > maxScroll) {
            maxScroll = scrollPercent;
            // Only log significant milestones (every 25%)
            if (maxScroll % 25 === 0) {
                trackEvent('scroll_depth', { depth_percentage: maxScroll });
            }
        }
    });

    // ================= CLEANUP =================
    
    // Set a timer to flush data periodically even if batch isn't full
    flushTimer = setInterval(() => {
        sendData();
    }, CONFIG.flushInterval);

    // Ensure data is sent if the user closes the tab
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            sendData();
        }
    });

})();