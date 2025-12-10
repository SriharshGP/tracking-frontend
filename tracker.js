(function() {
    // ================= CONFIGURATION =================
    const CONFIG = {
        //DEV
        //endpoint: "http://localhost:3000/api/sync", 

        //PROD
        endpoint: "https://google-ads-backend-tlvs.onrender.com/api/sync",

        batchSize: 5,
        flushInterval: 2000,
        throttleDelay: 100
    };

    // ================= STATE =================
    let eventQueue = [];
    let sessionID = null;
    let throttleTimer = null;
    let isTrackingActive = false; // Default: OFF

    // ================= CONSENT MANAGER =================
    function initConsent() {
        // 1. Check if user has already chosen
        const userChoice = localStorage.getItem('analytics_consent');

        if (userChoice === 'accepted') {
            startTracking(); // Already authorized? Start immediately.
        } else if (userChoice === 'declined') {
            console.log("Analytics: User declined tracking.");
            return; // Stop here. Do not load tracker.
        } else {
            // No choice found? Show the banner.
            showConsentBanner();
        }
    }

    function showConsentBanner() {
        // Create the Banner HTML
        const banner = document.createElement('div');
        banner.id = 'analytics-consent-banner';
        banner.style.cssText = `
            position: fixed; bottom: 0; left: 0; right: 0;
            background: #222; color: #fff; padding: 15px 20px;
            text-align: center; font-family: sans-serif; z-index: 2147483647;
            box-shadow: 0 -2px 10px rgba(0,0,0,0.2); border-top: 1px solid #444;
            display: flex; justify-content: center; align-items: center; gap: 20px;
        `;
        
        banner.innerHTML = `
            <span style="font-size: 14px;">We use cookies to improve your experience. Do you accept usage tracking?</span>
            <div>
                <button id="btn-decline" style="margin-right: 10px; padding: 8px 15px; background: transparent; color: #ccc; border: 1px solid #555; cursor: pointer; border-radius: 4px; font-size: 13px;">Decline</button>
                <button id="btn-accept" style="padding: 8px 15px; background: #007bff; color: #fff; border: none; cursor: pointer; border-radius: 4px; font-size: 13px; font-weight: bold;">Accept</button>
            </div>
        `;

        document.body.appendChild(banner);

        // Add Listeners to the buttons
        document.getElementById('btn-accept').addEventListener('click', () => {
            localStorage.setItem('analytics_consent', 'accepted'); // Remember choice
            document.body.removeChild(banner);
            startTracking(); // <--- ACTIVATE TRACKER
        });

        document.getElementById('btn-decline').addEventListener('click', () => {
            localStorage.setItem('analytics_consent', 'declined'); // Remember choice
            document.body.removeChild(banner);
        });
    }

    // ================= TRACKING CORE =================
    // This function only runs IF consent is given
    function startTracking() {
        if (isTrackingActive) return;
        isTrackingActive = true;
        console.log("Analytics: Tracking Started ✅");

        // Initialize Session
        sessionID = getSessionId();

        // 1. Track Page View
        trackEvent('page_view', { width: window.innerWidth, height: window.innerHeight });

        // 2. Track Clicks
        document.addEventListener('click', (e) => {
            // Ignore clicks ON the banner itself
            if (e.target.closest('#analytics-consent-banner')) return;

            trackEvent('click', {
                x: e.clientX, y: e.clientY,
                target_tag: e.target.tagName,
                target_id: e.target.id || null,
                target_class: e.target.className || null
            });
        });

        // 3. Track Mouse Movement
        document.addEventListener('mousemove', (e) => {
            const now = Date.now();
            if (throttleTimer && now < throttleTimer + CONFIG.throttleDelay) return;
            throttleTimer = now;
            trackEvent('mousemove', { x: e.clientX, y: e.clientY });
        });

        // 4. Track Scroll
        let maxScroll = 0;
        document.addEventListener('scroll', () => {
            const scrollPercent = Math.round((window.scrollY + window.innerHeight) / document.body.scrollHeight * 100);
            if (scrollPercent > maxScroll) {
                maxScroll = scrollPercent;
                if (maxScroll % 25 === 0) trackEvent('scroll_depth', { depth_percentage: maxScroll });
            }
        });

        // Start Sending Data
        setInterval(sendData, CONFIG.flushInterval);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') sendData();
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

    function trackEvent(type, data = {}) {
        eventQueue.push({ type: type, timestamp: Date.now(), ...data });
        if (eventQueue.length >= CONFIG.batchSize) sendData();
    }

    function sendData() {
        if (eventQueue.length === 0) return;
        const payload = {
            session_id: sessionID,
            url: window.location.href,
            timestamp: Date.now(),
            user_agent: navigator.userAgent,
            events: eventQueue
        };

        fetch(CONFIG.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true,
            credentials: 'omit'
        }).catch(console.error);

        eventQueue = [];
    }

    // ================= STARTUP =================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initConsent);
    } else {
        initConsent();
    }

})();