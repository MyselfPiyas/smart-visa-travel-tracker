import api from './api.js';

export async function listDocuments(params) {
  const response = await api.get('/traveler/documents', { params });
  return response.data;
}

export async function getDocument(documentId) {
  const response = await api.get(`/traveler/documents/${encodeURIComponent(documentId)}`);
  return response.data.document;
}

export async function createDocument(values) {
  const response = await api.post('/traveler/documents', values);
  return response.data.document;
}

export async function updateDocument(documentId, values) {
  const response = await api.patch(`/traveler/documents/${encodeURIComponent(documentId)}`, values);
  return response.data.document;
}

export async function uploadDocumentFiles(documentId, files) {
  const body = new FormData();
  for (const file of files) body.append('files', file);
  const response = await api.post(`/traveler/documents/${encodeURIComponent(documentId)}/files`, body);
  return response.data.document;
}

export async function deleteDocument(documentId) {
  await api.delete(`/traveler/documents/${encodeURIComponent(documentId)}`);
}

export async function downloadDocumentFile(documentId, fileId) {
  const response = await api.get(`/traveler/documents/${encodeURIComponent(documentId)}/files/${encodeURIComponent(fileId)}`, { responseType: 'blob' });
  return response.data;
}
