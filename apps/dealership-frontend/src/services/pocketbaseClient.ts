import PocketBase from 'pocketbase';

// Resolve PocketBase base URL from env
const rawBaseUrl = import.meta.env.VITE_POCKETBASE_URL;
const baseUrl = rawBaseUrl ? rawBaseUrl.trim() : rawBaseUrl;

if (!baseUrl) {
	// Surface a clear error early instead of a vague network failure later
	console.error('[PocketBase] Missing VITE_POCKETBASE_URL environment variable.');
	console.error('Set VITE_POCKETBASE_URL in .env.local (for local dev) and as a secret/env var in CI/CD (Vercel + GitHub Actions).');
}

export const pb = new PocketBase(baseUrl || '');
pb.autoCancellation(false);

// Simple connectivity / health check helper
export async function pocketBaseHealthCheck(): Promise<{ ok: boolean; error?: string }> {
	if (!baseUrl) {
		return { ok: false, error: 'VITE_POCKETBASE_URL not set' };
	}
	try {
		const res = await fetch(baseUrl.replace(/\/$/, '') + '/api/health');
		if (!res.ok) {
			return { ok: false, error: `Health endpoint status ${res.status}` };
		}
		return { ok: true };
	} catch (e: any) {
		return { ok: false, error: e.message || 'Network error' };
	}
}

export default pb;
