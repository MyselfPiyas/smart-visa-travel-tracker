import api from './api.js';

export async function getReminderPreferences() { return (await api.get('/traveler/notifications/preferences')).data.preferences; }
export async function updateReminderPreferences(values) { return (await api.put('/traveler/notifications/preferences', values)).data.preferences; }
export async function listNotifications(params = {}) { return (await api.get('/traveler/notifications', { params })).data; }
export async function getUpcomingNotifications(params = {}) { return (await api.get('/traveler/notifications/upcoming', { params })).data.items; }
export async function getNotification(id) { return (await api.get(`/traveler/notifications/${encodeURIComponent(id)}`)).data.notification; }
export async function markNotificationRead(id) { return (await api.patch(`/traveler/notifications/${encodeURIComponent(id)}/read`)).data.notification; }
export async function getAdminNotificationStats() { return (await api.get('/admin/notifications/stats')).data; }
export async function listAdminNotificationLogs(params = {}) { return (await api.get('/admin/notifications', { params })).data; }
export async function listAdminNotificationFailures(params = {}) { return (await api.get('/admin/notifications/failures', { params })).data; }
