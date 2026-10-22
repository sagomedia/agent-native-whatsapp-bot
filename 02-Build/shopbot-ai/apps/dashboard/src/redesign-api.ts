export async function redesignApi<T = any>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
 const response = await fetch('/api/owner/' + path, body === undefined ? {cache:'no-store',signal} : {method:'POST',headers:{'content-type':'application/json','x-shopbot-owner':'1'},body:JSON.stringify(body),signal});
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw Object.assign(new Error(data.error ?? data.message ?? 'Could not complete this action. Please try again.'), {status:response.status});
 return data as T;
}
