// Google Identity Services (GIS) — client-side "Sign in with Google" button.
// Hands back a signed Google ID token directly in the browser; we POST it to
// our own backend for verification. No OAuth redirect flow, no client secret.

declare global {
    interface Window {
        google?: any;
    }
}

let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (!scriptPromise) {
        scriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => { scriptPromise = null; reject(new Error('Failed to load Google Identity Services')); };
            document.body.appendChild(script);
        });
    }
    return scriptPromise;
}

export async function renderGoogleButton(opts: {
    clientId: string;
    container: HTMLElement;
    onCredential: (credential: string) => void;
}): Promise<void> {
    await loadGoogleScript();
    window.google.accounts.id.initialize({
        client_id: opts.clientId,
        callback: (response: { credential: string }) => opts.onCredential(response.credential),
    });
    opts.container.innerHTML = '';
    window.google.accounts.id.renderButton(opts.container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        width: 360,
        logo_alignment: 'center',
    });
}
