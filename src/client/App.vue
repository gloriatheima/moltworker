<script setup lang="ts">
import AdminPage from './pages/AdminPage.vue';
</script>

<template>
  <div class="app">
    <header class="app-header">
      <img src="/logo.png" alt="OpenClaw Worker" class="header-logo" />
      <h1>OpenClaw Admin</h1>
    </header>
    <main class="app-main">
      <AdminPage />
    </main>
  </div>
</template>

<style src="./App.css"></style>
