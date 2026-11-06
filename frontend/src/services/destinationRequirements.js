import api from './api.js';

export async function getDestinationChecklist(values) { return (await api.get('/traveler/destinations/checklist', { params: values })).data; }
export async function listDestinationRequirements(params = {}) { return (await api.get('/admin/destinations', { params })).data; }
export async function createDestinationRequirement(values) { return (await api.post('/admin/destinations', values)).data.requirement; }
export async function updateDestinationRequirement(id, values) { return (await api.patch(`/admin/destinations/${encodeURIComponent(id)}`, values)).data.requirement; }
export async function deactivateDestinationRequirement(id) { return (await api.patch(`/admin/destinations/${encodeURIComponent(id)}/deactivate`)).data.requirement; }
export async function deleteDestinationRequirement(id) { await api.delete(`/admin/destinations/${encodeURIComponent(id)}`); }
export async function listDestinationRequirementHistory(params = {}) { return (await api.get('/admin/destinations/history', { params })).data.items; }
