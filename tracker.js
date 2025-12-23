(function() {
    // ================= CONFIGURATION =================
    const CONFIG = {
        // 1. Point to YOUR Localhost Backend
        baseUrl: "http://localhost:5000", 
        
        // 2. Identity (IMPORTANT)
        // In a real app, this comes from a cookie or window.currentUser
        // We use the email from our seed script to make 'Delete Data' work
        userIdentity: "user@test.com", 

        batchSize: 5,
        flushInterval: 2000,
        throttleDelay: 100
    };

    // ================= STATE =================
    let eventQueue = [];
    let sessionID = null;
    let throttleTimer = null;
    let isTrackingActive = false; 

    // ================= CONSENT MANAGER =================
    async function initConsent() {
        console.log(`[Tracker] Checking consent for: ${CONFIG.userIdentity}...`);

        try {
            // STEP 1: Ask the Backend (The Source of Truth)
            const response = await fetch(`${CONFIG.baseUrl}/check-consent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: CONFIG.userIdentity })
            });

            const data = await response.json();

            // STEP 2: Logic Flow
            if (data.allowed === true) {
                // Backend says YES -> Start immediately
                console.log("[Tracker] Consent verified by Server.");
                startTracking();
            } else {
                // Backend says NO (or user unknown) -> Show Banner?
                // For this tutorial, if backend says NO, we assume revoked/new user.
                // We check if they explicitly revoked it previously.
                if (localStorage.getItem('analytics_consent') === 'declined') {
                    console.log("[Tracker] User explicitly declined locally.");
                    return;
                }
                showConsentBanner();
            }
        } catch (err) {
            console.error("[Tracker] Backend offline. Falling back to local check.", err);
            // Fallback: If server is down, trust local storage
            if (localStorage.getItem('analytics_consent') === 'accepted') startTracking();
            else showConsentBanner();
        }
    }

    function showConsentBanner() {
        if (document.getElementById('analytics-consent-banner')) return; // Don't show twice

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
            // 1. Save Local
            localStorage.setItem('analytics_consent', 'accepted'); 
            // 2. Remove Banner
            document.body.removeChild(banner);
            // 3. Start Tracking
            startTracking(); 
            // 4. (Optional) Tell Backend we accepted? 
            // For now, tracking simply starts sending data, which works.
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

        // 1. Track Page View
        trackEvent('page_view', { width: window.innerWidth, height: window.innerHeight });

        // 2. Track Clicks
        document.addEventListener('click', (e) => {
            if (e.target.closest('#analytics-consent-banner')) return;
            trackEvent('click', { x: e.clientX, y: e.clientY, tag: e.target.tagName });
        });

        // 3. Track Mouse Movement
        document.addEventListener('mousemove', (e) => {
            const now = Date.now();
            if (throttleTimer && now < throttleTimer + CONFIG.throttleDelay) return;
            throttleTimer = now;
            trackEvent('mousemove', { x: e.clientX, y: e.clientY });
        });

        // Flush data periodically
        setInterval(sendData, CONFIG.flushInterval);
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
        eventQueue.push({ type: type, time: Date.now(), ...data }); // 'time' matches our backend schema
        if (eventQueue.length >= CONFIG.batchSize) sendData();
    }

    function sendData() {
        if (eventQueue.length === 0) return;

        // FILTER: Our simple backend only knows how to save 'mousemove' for now.
        // We filter the queue to find mouse moves and map them to the structure backend expects.
        // Backend expects: { email, movements: [ { x, y, time } ] }
        
        const mouseMovements = eventQueue
            .filter(e => e.type === 'mousemove')
            .map(e => ({ x: e.x, y: e.y, time: e.time }));

        if (mouseMovements.length > 0) {
            fetch(`${CONFIG.baseUrl}/api/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionID, // <--- Added session_id
                    email: CONFIG.userIdentity, // <--- CRITICAL: Links data to the User
                    movements: mouseMovements,
                    event_type: 'batch_mouse_movements'
                }),
                keepalive: true
            }).catch(err => console.error("[Tracker] Send failed", err));
        }

        // Clear queue after sending
        eventQueue = [];
    }

    // ================= STARTUP =================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initConsent);
    } else {
        initConsent();
    }

})();
