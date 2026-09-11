const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';
console.log("API_BASE =", API_BASE);
function getToken() {
  return localStorage.getItem('fp_token');
}
async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.blob();
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}
export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me'),
  createUser: (payload) => request('/auth/users', { method: 'POST', body: payload }),
  updateUser: (userId, payload) => request(`/auth/users/${userId}`, { method: 'PATCH', body: payload }),
  deleteUser: (userId) => request(`/auth/users/${userId}`, { method: 'DELETE' }),
  listUsers: () => request('/auth/users'),
  listProjects: () => request('/projects'),
  createProject: (name, type) => request('/projects', { method: 'POST', body: { name, type } }),
  renameProject: (projectId, name) => request(`/projects/${projectId}`, { method: 'PATCH', body: { name } }),
  deleteProject: (projectId) => request(`/projects/${projectId}`, { method: 'DELETE' }),
  listReleases: (projectId) => request(`/projects/${projectId}/releases`),
  getRelease: (releaseId) => request(`/releases/${releaseId}`),
  createRelease: (projectId, formData) =>
    request(`/projects/${projectId}/releases`, { method: 'POST', body: formData, isForm: true }),
  updateStage: (releaseId, stageNumber, status, remarks, date) =>
    request(`/releases/${releaseId}/stages/${stageNumber}`, {
      method: 'PATCH',
      body: { status, remarks, date },
    }),
  deleteRelease: (releaseId) => request(`/releases/${releaseId}`, { method: 'DELETE' }),
  downloadFile: async (releaseId, fileType) => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/releases/${releaseId}/download/${fileType}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Download failed');
    }
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="(.+?)"/);
    const filename = match ? match[1] : `firmware.${fileType}`;
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
  createTicket: (payload) => request('/tickets', { method: 'POST', body: payload }),
  trackTicket: (code) => request(`/tickets/track/${encodeURIComponent(code)}`),
  listTickets: (status) => request(`/tickets${status ? `?status=${status}` : ''}`),
  updateTicket: (id, payload) => request(`/tickets/${id}`, { method: 'PATCH', body: payload }),
};
export { API_BASE, getToken };
