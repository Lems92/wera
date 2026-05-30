// Lightweight wrapper around Google Identity Services that initializes the
// library exactly once per page load. Multiple React components (Login,
// Register) were each calling google.accounts.id.initialize(...) on mount,
// which fires the "initialize() is called multiple times" GSI_LOGGER
// warning and silently discards every callback except the last one.
//
// Usage from a component:
//   const { mount, unmount } = setupGoogleButton({
//       buttonRef,
//       onCredential: (credential) => { ... }
//   });
//   useEffect(() => { mount(); return unmount; }, []);

let initialized = false;
let currentCallback = null;

// One stable callback registered with GSI. It dispatches to whatever the
// most-recently-mounted component is interested in. This is fine because
// only one auth screen is visible at a time.
function dispatch(response) {
    if (typeof currentCallback === 'function') {
        currentCallback(response?.credential);
    }
}

function initOnce(clientId) {
    if (initialized) return true;
    if (!window.google?.accounts?.id) return false;

    try {
        window.google.accounts.id.initialize({
            client_id: clientId,
            callback: dispatch
        });
        initialized = true;
        return true;
    } catch {
        return false;
    }
}

export function setupGoogleButton({ buttonRef, onCredential, buttonOptions }) {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    let interval = null;
    let timeout = null;
    let cancelled = false;

    const mount = () => {
        if (!clientId || !buttonRef?.current) return;

        const tryRender = () => {
            if (cancelled) return false;
            if (!initOnce(clientId)) return false;
            currentCallback = onCredential;
            try {
                buttonRef.current.innerHTML = '';
                window.google.accounts.id.renderButton(buttonRef.current, buttonOptions || {
                    theme: 'outline',
                    size: 'large',
                    shape: 'pill',
                    width: 340,
                    text: 'continue_with'
                });
                return true;
            } catch {
                return false;
            }
        };

        if (tryRender()) return;
        // GSI script is async — retry briefly while it loads.
        interval = setInterval(() => { if (tryRender()) clearInterval(interval); }, 250);
        timeout = setTimeout(() => clearInterval(interval), 5000);
    };

    const unmount = () => {
        cancelled = true;
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        if (currentCallback === onCredential) currentCallback = null;
    };

    return { mount, unmount };
}
