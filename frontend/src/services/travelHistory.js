import api from './api.js';

export async function listTravelRecords(params = {}) { return (await api.get('/traveler/travel-history', { params })).data; }
export async function getTravelRecord(id) { return (await api.get(`/traveler/travel-history/${encodeURIComponent(id)}`)).data.record; }
export async function createTravelRecord(values) { return (await api.post('/traveler/travel-history', values)).data.record; }
export async function updateTravelRecord(id, values) { return (await api.patch(`/traveler/travel-history/${encodeURIComponent(id)}`, values)).data.record; }
export async function deleteTravelRecord(id) { await api.delete(`/traveler/travel-history/${encodeURIComponent(id)}`); }
