import { createApp } from 'vue';
import App from './App.vue';
import { fetchCatalog } from './catalog/catalog-api';

createApp(App).mount('#app');
void fetchCatalog();
