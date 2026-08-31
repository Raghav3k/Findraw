// Pages service binding FINDRAW_BACKEND points to findraw-backend.
// No browser token, proxy secret or caller-selected upstream URL is used.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/") || path.startsWith("/auth/")) {
      if (!env.FINDRAW_BACKEND) return new Response("Backend service binding is not configured.", { status: 503 });
      return env.FINDRAW_BACKEND.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
