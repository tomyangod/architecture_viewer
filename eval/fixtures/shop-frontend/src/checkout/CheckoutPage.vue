<template>
  <section>
    <h1>Checkout</h1>
    <p>Total {{ total }}</p>
  </section>
</template>

<script setup lang="ts">
import { cartTotal } from './cart';

const total = cartTotal();
</script>
