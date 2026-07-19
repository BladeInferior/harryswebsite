import { requireAdminAuth } from './auth.js';

requireAdminAuth().then(() => {
    document.getElementById('admin-content').classList.remove('hidden');
});
