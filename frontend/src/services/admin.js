import api from './api.js';
export async function getAdminSummary(){return (await api.get('/admin/dashboard/summary')).data;}
export async function getAdminActivity(params={}){return (await api.get('/admin/dashboard/activity',{params})).data.items;}
export async function getAdminCompliance(){return (await api.get('/admin/dashboard/compliance-summary')).data;}
export async function listAdminUsers(params={}){return (await api.get('/admin/users',{params})).data;}
export async function getAdminUser(id){return (await api.get(`/admin/users/${encodeURIComponent(id)}`)).data;}
export async function setAdminUserStatus(id,accountStatus){return (await api.patch(`/admin/users/${encodeURIComponent(id)}/status`,{accountStatus})).data.user;}
export async function listSupportQueries(params={}){return (await api.get('/admin/support',{params})).data;}
export async function getSupportQuery(id){return (await api.get(`/admin/support/${encodeURIComponent(id)}`)).data.query;}
export async function replyToSupportQueryAsAdmin(id,message,status='waiting_for_user'){return (await api.post(`/admin/support/${encodeURIComponent(id)}/replies`,{message,status})).data.query;}
export async function updateSupportQueryStatus(id,status){return (await api.patch(`/admin/support/${encodeURIComponent(id)}/status`,{status})).data.query;}
