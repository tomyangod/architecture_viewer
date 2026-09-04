<template>
  <section>
    <h1>Catalog</h1>
    <ul>
      <li v-for="item in items" :key="item.id">{{ item.name }}</li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { fetchCatalog, type Product } from './catalog-api';

const items = ref<Product[]>([]);
fetchCatalog().then((rows) => {
  items.value = rows;
});
</script>
