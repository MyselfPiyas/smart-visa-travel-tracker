import api from './api.js';

export async function listMySupportQueries(params = {}) { return (await api.get('/traveler/support', { params })).data; }
export async function createSupportQuery(values) { return (await api.post('/traveler/support', values)).data.query; }
export async function getMySupportQuery(id) { return (await api.get(`/traveler/support/${encodeURIComponent(id)}`)).data.query; }
export async function replyToSupportQuery(id, message) { return (await api.post(`/traveler/support/${encodeURIComponent(id)}/replies`, { message })).data.query; }
