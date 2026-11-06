export const routes = {
  home: '/', register: '/register', login: '/login', status: '/status',
  traveler: { root: '/app', dashboard: '/app/dashboard', documents: '/app/documents', upload: '/app/documents/upload', documentDetails: '/app/documents/:documentId', reminders: '/app/reminders', notifications: '/app/notifications', notificationDetails: '/app/notifications/:notificationId', travelHistory: '/app/travel-history', newTravelRecord: '/app/travel-history/new', travelRecordDetails: '/app/travel-history/:recordId', editTravelRecord: '/app/travel-history/:recordId/edit', checklist: '/app/checklist', profile: '/app/profile', support: '/app/support', supportDetails: '/app/support/:queryId' },
  admin: { root: '/admin', dashboard: '/admin/dashboard', users: '/admin/users', notifications: '/admin/notifications', destinations: '/admin/destinations', support: '/admin/support', supportDetails: '/admin/support/:queryId' },
};
