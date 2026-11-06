import api from './api.js';

export async function getProfile() { return (await api.get('/traveler/profile')).data.profile; }
export async function updateProfile(values) { return (await api.patch('/traveler/profile', values)).data.profile; }
export async function changePassword(values) { return (await api.post('/traveler/profile/password', values)).data; }
